import { DomainError } from '../domain/errors.ts';
import {
  getPublicQuestion,
  getPublicResult,
  getQuestionProgress,
  getRanking,
  getStudentResults,
} from '../domain/session/game.ts';
import type { Session } from '../domain/session/session.ts';
import type { SessionService } from '../services/session-service.ts';
import { WorkbookResultsService } from '../services/workbook-results-service.ts';
import type { WorkbookStorage } from '../services/workbook-storage.ts';
import type { LobbyOperation, LobbyServer, LobbySocket } from './events.ts';
import type { LobbyLog } from './lobby-handlers.ts';
import {
  LobbyRequestError,
  parseStudentAnswer,
  parseTeacherReconnect,
} from './payloads.ts';

type RunOperation = (
  operation: LobbyOperation,
  action: () => void | Promise<void>,
) => Promise<void>;
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;
export const teacherRoom = (sessionId: string) => `teacher:${sessionId}`;

/** Adaptador de eventos y temporizadores; las reglas de juego viven en SessionService. */
export function createGameHandlers(
  io: LobbyServer,
  sessions: SessionService,
  logger: (entry: LobbyLog) => void,
  storage: WorkbookStorage | undefined,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const results = new WorkbookResultsService(
    sessions,
    storage,
    (sessionId, status) => {
      io.to(teacherRoom(sessionId)).emit('workbook:save-updated', status);
      if (status.status === 'saved')
        logger({ event: 'workbook_updated', sessionId });
      else if (status.status === 'error')
        logger({
          event: 'workbook_update_failed',
          sessionId,
          code: status.error!.code,
        });
    },
  );

  function cancelTimer(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }

  function publishClosed(session: Session) {
    cancelTimer(session.id);
    io.to(sessionRoom(session.id)).emit(
      'question:ended',
      getPublicResult(session)!,
    );
    const ranking = getRanking(session);
    io.to(sessionRoom(session.id)).emit('ranking:updated', ranking);
    for (const result of getStudentResults(session, ranking)) {
      const participant = session.participants.get(result.participantId)!;
      if (participant.connected && participant.socketId) {
        io.to(participant.socketId).emit('student:result', result);
      }
    }
    logger({ event: 'question_closed', sessionId: session.id });
    // Publicar ranking antes de iniciar la E/S; el resultado permanece en memoria.
    void results.saveLatest(session.id).catch(() => {
      logger({ event: 'workbook_update_failed', sessionId: session.id });
    });
  }

  function closeExpired(id: string) {
    const closed = sessions.closeExpiredQuestion(id);
    if (closed) publishClosed(closed);
  }

  function scheduleTimer(id: string) {
    cancelTimer(id);
    const remaining = sessions.remainingQuestionTime(id);
    if (remaining === null) return;
    const timer = setTimeout(() => {
      timers.delete(id);
      try {
        closeExpired(id);
        // Reprogramar si el reloj del servidor se ha retrasado.
        if (sessions.remainingQuestionTime(id) !== null) scheduleTimer(id);
      } catch (error) {
        if (!(
          error instanceof DomainError && error.code === 'SESSION_NOT_FOUND'
        ))
          logger({ event: 'question_timer_failed', sessionId: id });
      }
    }, remaining);
    timer.unref();
    timers.set(id, timer);
  }

  function publishStarted(session: Session) {
    scheduleTimer(session.id);
    io.to(sessionRoom(session.id)).emit(
      'question:started',
      getPublicQuestion(session)!,
    );
    io.to(teacherRoom(session.id)).emit(
      'question:progress',
      getQuestionProgress(session)!,
    );
    logger({ event: 'question_started', sessionId: session.id });
  }

  function restore(socket: LobbySocket) {
    const membership = socket.data.membership;
    if (!membership) return;
    closeExpired(membership.sessionId);
    socket.emit(
      'game:updated',
      sessions.getGameSnapshot(
        membership.sessionId,
        membership.role === 'student' ? membership.participantId : undefined,
      ),
    );
  }

  function register(socket: LobbySocket, run: RunOperation) {
    for (const event of [
      'teacher:start-game',
      'teacher:start-next-question',
      'teacher:close-question',
      'teacher:end-game',
      'teacher:retry-save-results',
    ] as const) {
      socket.on(event, (payload) => {
        void run(event, async () => {
          const { sessionId, teacherToken } = parseTeacherReconnect(payload);
          const membership = socket.data.membership;
          if (
            membership?.role !== 'teacher' ||
            membership.sessionId !== sessionId
          )
            throw new LobbyRequestError(
              'FORBIDDEN',
              'No tienes permiso para controlar esta partida.',
            );
          // El servicio valida el token antes de cambiar cualquier estado.
          if (event === 'teacher:start-game')
            publishStarted(sessions.startGame(sessionId, teacherToken));
          else if (event === 'teacher:start-next-question')
            publishStarted(sessions.startNextQuestion(sessionId, teacherToken));
          else if (event === 'teacher:close-question')
            publishClosed(sessions.closeQuestion(sessionId, teacherToken));
          else if (event === 'teacher:retry-save-results') {
            sessions.reconnectTeacher(sessionId, teacherToken);
            socket.emit(
              'workbook:save-updated',
              await results.saveLatest(sessionId),
            );
          } else {
            const session = sessions.endGame(sessionId, teacherToken);
            cancelTimer(sessionId);
            const ranking = getRanking(session);
            io.to(sessionRoom(sessionId)).emit('game:ended', {
              ranking,
              podium: ranking.slice(0, 3),
            });
            logger({ event: 'session_finished', sessionId });
          }
        });
      });
    }

    socket.on('student:answer', (payload) => {
      void run('student:answer', () => {
        const { questionId, answerOptionId } = parseStudentAnswer(payload);
        const membership = socket.data.membership;
        if (membership?.role !== 'student')
          throw new LobbyRequestError(
            'FORBIDDEN',
            'Entra como alumno para responder.',
          );
        closeExpired(membership.sessionId);
        const answer = sessions.submitAnswer(
          membership.sessionId,
          membership.participantId,
          socket.id,
          questionId,
          answerOptionId,
        );
        socket.emit('answer:accepted', {
          questionId: answer.questionId,
          answerOptionId: answer.answerOptionId,
        });
        if (answer.accepted)
          io.to(teacherRoom(membership.sessionId)).emit(
            'question:progress',
            getQuestionProgress(sessions.getSession(membership.sessionId))!,
          );
      });
    });
  }

  return {
    register,
    restore,
    pruneTimers() {
      for (const id of timers.keys()) {
        try {
          if (sessions.remainingQuestionTime(id) === null) cancelTimer(id);
        } catch {
          cancelTimer(id);
        }
      }
    },
    dispose() {
      for (const id of timers.keys()) cancelTimer(id);
    },
  };
}
