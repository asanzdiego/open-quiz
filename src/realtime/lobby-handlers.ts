import { DomainError } from '../domain/errors.ts';
import { getLobbySnapshot } from '../domain/session/lobby.ts';
import { ExcelImportError } from '../excel/excel-import-error.ts';
import { loadSessionWorkbook } from '../services/load-session-workbook.ts';
import type { SessionService } from '../services/session-service.ts';
import { WorkbookStorageError } from '../services/workbook-storage-error.ts';
import type { WorkbookStorage } from '../services/workbook-storage.ts';
import type { AppError, LobbyOperation, LobbyServer } from './events.ts';
import {
  LobbyRequestError,
  parseCreateSession,
  parseStudentJoin,
  parseStudentReconnect,
  parseTeacherReconnect,
} from './payloads.ts';
import { LobbyRateLimiter } from './rate-limiter.ts';
import {
  createGameHandlers,
  sessionRoom as room,
  teacherRoom,
} from './game-handlers.ts';

export interface LobbyLog {
  event: string;
  sessionId?: string;
  participantId?: string;
  operation?: LobbyOperation;
  code?: string;
}
export interface LobbyHandlerOptions {
  sessions: SessionService;
  storage: WorkbookStorage | undefined;
  logger?: (entry: LobbyLog) => void;
}

function publicError(error: unknown, operation: LobbyOperation): AppError {
  if (
    error instanceof DomainError ||
    error instanceof WorkbookStorageError ||
    error instanceof ExcelImportError ||
    error instanceof LobbyRequestError
  ) {
    return { operation, code: error.code, message: error.message };
  }
  return {
    operation,
    code: 'INTERNAL_ERROR',
    message: 'No se ha podido completar la operación. Inténtalo de nuevo.',
  };
}

export function registerLobbyHandlers(
  io: LobbyServer,
  {
    sessions,
    storage,
    logger = (entry) => console.info(JSON.stringify(entry)),
  }: LobbyHandlerOptions,
) {
  const limiter = new LobbyRateLimiter();
  const game = createGameHandlers(io, sessions, logger, storage);
  const publishLobby = (sessionId: string) => {
    io.to(room(sessionId)).emit(
      'lobby:updated',
      getLobbySnapshot(sessions.getSession(sessionId)),
    );
  };

  io.on('connection', (socket) => {
    async function run(
      operation: LobbyOperation,
      action: () => void | Promise<void>,
      unjoined = true,
    ): Promise<void> {
      if (socket.data.busy) {
        socket.emit('app:error', {
          operation,
          code: 'OPERATION_IN_PROGRESS',
          message: 'Espera a que termine la operación anterior.',
        });
        return;
      }
      socket.data.busy = true;
      try {
        if (unjoined)
          limiter.check(
            socket.handshake.address,
            operation === 'teacher:create-session',
          );
        else limiter.checkGameplay(socket.id);
        if (unjoined && socket.data.membership) {
          throw new LobbyRequestError(
            'ALREADY_JOINED',
            'Esta conexión ya pertenece a una partida.',
          );
        }
        await action();
      } catch (error) {
        const safeError = publicError(error, operation);
        socket.emit('app:error', safeError);
        logger({
          event: 'lobby_operation_failed',
          operation,
          code: safeError.code,
        });
      } finally {
        socket.data.busy = false;
      }
    }

    socket.on('teacher:create-session', (payload) => {
      void run('teacher:create-session', async () => {
        const { workbookReference } = parseCreateSession(payload);
        const workbook = await loadSessionWorkbook(storage, workbookReference);
        // Evitar partidas huérfanas si el profesor cierra la página durante la descarga.
        if (!socket.connected) return;
        const session = sessions.createSession(workbook);
        socket.data.membership = { role: 'teacher', sessionId: session.id };
        await socket.join([room(session.id), teacherRoom(session.id)]);
        socket.emit('session:created', {
          sessionId: session.id,
          joinCode: session.joinCode,
          teacherToken: session.teacherToken,
          lobby: getLobbySnapshot(session),
        });
        logger({ event: 'session_created', sessionId: session.id });
        game.restore(socket);
      });
    });

    socket.on('teacher:reconnect', (payload) => {
      void run('teacher:reconnect', async () => {
        const { sessionId, teacherToken } = parseTeacherReconnect(payload);
        const session = sessions.reconnectTeacher(sessionId, teacherToken);
        // Solo un socket de profesor activo; el token sigue siendo privado del navegador.
        io.in(teacherRoom(session.id)).disconnectSockets(true);
        socket.data.membership = { role: 'teacher', sessionId: session.id };
        await socket.join([room(session.id), teacherRoom(session.id)]);
        socket.emit('session:restored', {
          sessionId: session.id,
          joinCode: session.joinCode,
          teacherToken: session.teacherToken,
          lobby: getLobbySnapshot(session),
        });
        logger({ event: 'teacher_reconnected', sessionId: session.id });
        game.restore(socket);
      });
    });

    socket.on('student:join', (payload) => {
      void run('student:join', async () => {
        const { joinCode, nick } = parseStudentJoin(payload);
        const session = sessions.getSessionByJoinCode(joinCode);
        const participant = sessions.joinSession(joinCode, nick, socket.id);
        socket.data.membership = {
          role: 'student',
          sessionId: session.id,
          participantId: participant.id,
        };
        await socket.join(room(session.id));
        socket.emit('student:joined', {
          joinCode: session.joinCode,
          participantId: participant.id,
          reconnectToken: participant.reconnectToken,
          nick: participant.nick,
          totalPoints: participant.totalPoints,
          lobby: getLobbySnapshot(sessions.getSession(session.id)),
        });
        publishLobby(session.id);
        logger({
          event: 'participant_joined',
          sessionId: session.id,
          participantId: participant.id,
        });
        game.restore(socket);
      });
    });

    socket.on('student:reconnect', (payload) => {
      void run('student:reconnect', async () => {
        const { joinCode, participantId, reconnectToken } =
          parseStudentReconnect(payload);
        const session = sessions.getSessionByJoinCode(joinCode);
        const previousSocketId =
          session.participants.get(participantId)?.socketId;
        const participant = sessions.reconnectParticipant(
          joinCode,
          participantId,
          reconnectToken,
          socket.id,
        );
        socket.data.membership = {
          role: 'student',
          sessionId: session.id,
          participantId,
        };
        // El dominio ya apunta al nuevo socket: un disconnect tardío no lo invalida.
        if (previousSocketId)
          io.sockets.sockets.get(previousSocketId)?.disconnect(true);
        await socket.join(room(session.id));
        socket.emit('student:restored', {
          joinCode: session.joinCode,
          participantId,
          reconnectToken: participant.reconnectToken,
          nick: participant.nick,
          totalPoints: participant.totalPoints,
          lobby: getLobbySnapshot(sessions.getSession(session.id)),
        });
        publishLobby(session.id);
        logger({
          event: 'participant_reconnected',
          sessionId: session.id,
          participantId,
        });
        game.restore(socket);
      });
    });

    game.register(socket, (operation, action) => run(operation, action, false));

    socket.on('disconnect', () => {
      const membership = socket.data.membership;
      if (membership?.role !== 'student') return;
      try {
        if (
          sessions.disconnectParticipant(
            membership.sessionId,
            membership.participantId,
            socket.id,
          )
        )
          publishLobby(membership.sessionId);
      } catch (error) {
        // Una sesión expirada puede desaparecer antes de llegar el disconnect.
        if (!(
          error instanceof DomainError && error.code === 'SESSION_NOT_FOUND'
        )) {
          logger({ event: 'participant_disconnect_failed' });
        }
      }
    });
  });
  return game;
}
