import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/app.ts';
import { readConfig } from '../src/config/env.ts';
import { InMemorySessionRepository } from '../src/domain/session/in-memory-session-repository.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  StudentJoinPayload,
  TeacherSession,
} from '../src/realtime/events.ts';
import { SessionService } from '../src/services/session-service.ts';
import { WorkbookStorageError } from '../src/services/workbook-storage-error.ts';
import { InMemoryWorkbookStorage } from './helpers/in-memory-workbook-storage.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type EventPayload<K extends keyof ServerToClientEvents> = Parameters<
  ServerToClientEvents[K]
>[0];

function nextEvent<K extends keyof ServerToClientEvents>(
  client: Client,
  event: K,
): Promise<EventPayload<K>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, listener as never);
      reject(new Error(`No se ha recibido ${event}.`));
    }, 2000);
    const listener = (payload: EventPayload<K>) => {
      clearTimeout(timer);
      resolve(payload);
    };
    client.once(event, listener as never);
  });
}

describe('Fase 5: creación, lobby y reconexión por Socket.IO', () => {
  let application: ReturnType<typeof createApplication>;
  let repository: InMemorySessionRepository;
  let sessions: SessionService;
  let storage: InMemoryWorkbookStorage;
  let data: Buffer;
  let baseUrl: string;
  let clients: Client[];
  const reference = 'Quiz/prueba.xlsx';
  const logger = vi.fn();

  beforeEach(async () => {
    clients = [];
    logger.mockClear();
    repository = new InMemorySessionRepository();
    sessions = new SessionService(repository);
    storage = new InMemoryWorkbookStorage();
    data = await readFile(
      new URL('./fixtures/excel/valid-header.xlsx', import.meta.url),
    );
    await storage.uploadWorkbook(reference, data);
    application = createApplication({
      workbookStorage: storage,
      sessions,
      logger,
    });
    await listen();
  });

  async function listen() {
    await new Promise<void>((resolve, reject) => {
      application.httpServer.once('error', reject);
      application.httpServer.listen(0, '127.0.0.1', () => {
        application.httpServer.removeListener('error', reject);
        resolve();
      });
    });
    baseUrl = `http://127.0.0.1:${(application.httpServer.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
  });

  async function client(): Promise<Client> {
    const socket: Client = connect(baseUrl, {
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
      timeout: 1500,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }

  async function createTeacher(): Promise<{
    socket: Client;
    session: TeacherSession;
  }> {
    const socket = await client();
    const response = nextEvent(socket, 'session:created');
    socket.emit('teacher:create-session', {
      workbookReference: ` /${reference} `,
    });
    return { socket, session: await response };
  }

  async function join(socket: Client, joinCode: string, nick: string) {
    const response = nextEvent(socket, 'student:joined');
    socket.emit('student:join', { joinCode, nick });
    return response;
  }

  it('descarga y valida el XLSX, crea la sesión y actualiza el lobby con tres alumnos', async () => {
    const download = vi.spyOn(storage, 'downloadWorkbook');
    const upload = vi.spyOn(storage, 'uploadWorkbook');
    const teacher = await createTeacher();
    expect(download).toHaveBeenCalledExactlyOnceWith(reference);
    expect(upload).not.toHaveBeenCalled();
    expect(teacher.session.lobby).toMatchObject({
      state: 'LOBBY',
      questionCount: 2,
      participants: [],
    });
    const internal = sessions.getSession(teacher.session.sessionId);
    expect(internal.workbookReference).toBe(reference);
    expect(
      internal.questions.map((question) => question.correctAnswer),
    ).toEqual(['4', 'Marte']);
    for (const nick of ['Ana', 'Luis', 'María']) {
      const update = nextEvent(teacher.socket, 'lobby:updated');
      const student = await join(
        await client(),
        teacher.session.joinCode.toLowerCase(),
        ` ${nick} `,
      );
      expect(student.nick).toBe(nick);
      expect(student.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      const lobby = await update;
      expect(lobby.participants.at(-1)).toMatchObject({
        nick,
        connected: true,
        totalPoints: 0,
      });
      const serialized = JSON.stringify(lobby);
      for (const secret of [
        teacher.session.teacherToken,
        student.reconnectToken,
        reference,
        'correctAnswer',
        'incorrectAnswers',
        'socketId',
        'questions',
      ])
        expect(serialized).not.toContain(secret);
    }
    expect(sessions.getSession(internal.id).participants.size).toBe(3);
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      teacher.session.teacherToken,
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(reference);
  });

  it('rechaza el nick duplicado y un código inexistente sin modificar el lobby', async () => {
    const teacher = await createTeacher();
    await join(await client(), teacher.session.joinCode, 'Ana');
    const duplicate = await client();
    const error = nextEvent(duplicate, 'app:error');
    duplicate.emit('student:join', {
      joinCode: teacher.session.joinCode,
      nick: ' ana ',
    });
    expect(await error).toMatchObject({ code: 'NICK_TAKEN' });
    const missing = nextEvent(duplicate, 'app:error');
    duplicate.emit('student:join', { joinCode: 'ZZZ999', nick: 'Otro' });
    expect(await missing).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(
      sessions.getSession(teacher.session.sessionId).participants.size,
    ).toBe(1);
  });

  it.each([
    null,
    [],
    {},
    { joinCode: 123, nick: 'Ana' },
    { joinCode: 'ABC234', nick: '' },
    { joinCode: 'ABC234', nick: 'a'.repeat(25) },
    { joinCode: 'ABC234', nick: 'Ana', teacherToken: 'infiltrado' },
  ])('valida el payload entrante %j', async (payload) => {
    const socket = await client();
    const error = nextEvent(socket, 'app:error');
    socket.emit('student:join', payload as StudentJoinPayload);
    expect(await error).toMatchObject({ operation: 'student:join' });
    expect(repository.size).toBe(0);
  });

  it.each(['https://user:password@host/quiz.xlsx', '../quiz.xlsx', 'quiz.csv'])(
    'rechaza la referencia %s antes de descargar',
    async (workbookReference) => {
      const download = vi.spyOn(storage, 'downloadWorkbook');
      const socket = await client();
      const response = nextEvent(socket, 'app:error');
      socket.emit('teacher:create-session', { workbookReference });
      expect(await response).toMatchObject({ code: 'INVALID_REFERENCE' });
      expect(download).not.toHaveBeenCalled();
      expect(repository.size).toBe(0);
    },
  );

  it('un XLSX inválido no crea una sesión', async () => {
    await storage.uploadWorkbook(
      reference,
      await readFile(
        new URL('./fixtures/excel/incomplete-row.xlsx', import.meta.url),
      ),
    );
    const socket = await client();
    const response = nextEvent(socket, 'app:error');
    socket.emit('teacher:create-session', { workbookReference: reference });
    expect(await response).toMatchObject({ code: 'INVALID_ROW' });
    expect(repository.size).toBe(0);
  });

  it('muestra el error seguro de Nextcloud sin crear una sesión', async () => {
    vi.spyOn(storage, 'downloadWorkbook').mockRejectedValue(
      new WorkbookStorageError('PERMISSION_DENIED'),
    );
    const socket = await client();
    const response = nextEvent(socket, 'app:error');
    socket.emit('teacher:create-session', { workbookReference: reference });
    expect(await response).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(repository.size).toBe(0);
  });

  it('oculta detalles de errores inesperados en eventos y logs', async () => {
    const secret = 'password=secreto&teacherToken=privado';
    vi.spyOn(storage, 'downloadWorkbook').mockRejectedValue(new Error(secret));
    const socket = await client();
    const response = nextEvent(socket, 'app:error');
    socket.emit('teacher:create-session', { workbookReference: reference });
    expect(await response).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    expect(repository.size).toBe(0);
  });

  it('arranca sin Nextcloud y devuelve un error comprensible al crear', async () => {
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
    application = createApplication({ sessions, logger });
    await listen();
    const socket = await client();
    const response = nextEvent(socket, 'app:error');
    socket.emit('teacher:create-session', { workbookReference: reference });
    expect(await response).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    expect(repository.size).toBe(0);
  });

  it('reconecta al alumno con ID y token y conserva sus puntos sin duplicarlo', async () => {
    const teacher = await createTeacher();
    const first = await client();
    const initialLobby = nextEvent(teacher.socket, 'lobby:updated');
    const participant = await join(first, teacher.session.joinCode, 'Ana');
    await initialLobby;
    const internal = repository
      .getById(teacher.session.sessionId)
      ?.participants.get(participant.participantId);
    if (!internal) throw new Error('Falta el participante de prueba.');
    internal.totalPoints = 750;
    const disconnected = nextEvent(teacher.socket, 'lobby:updated');
    first.disconnect();
    expect((await disconnected).participants[0]?.connected).toBe(false);
    const second = await client();
    const restored = nextEvent(second, 'student:restored');
    const connected = nextEvent(teacher.socket, 'lobby:updated');
    second.emit('student:reconnect', {
      joinCode: participant.joinCode,
      participantId: participant.participantId,
      reconnectToken: participant.reconnectToken,
    });
    expect(await restored).toMatchObject({
      participantId: participant.participantId,
      nick: 'Ana',
      totalPoints: 750,
    });
    expect((await connected).participants).toEqual([
      {
        id: participant.participantId,
        nick: 'Ana',
        totalPoints: 750,
        connected: true,
      },
    ]);
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      participant.reconnectToken,
    );
  });

  it('sustituye el socket anterior del alumno y el disconnect tardío no lo desconecta', async () => {
    const teacher = await createTeacher();
    const old = await client();
    const participant = await join(old, teacher.session.joinCode, 'Ana');
    const disconnected = new Promise<string>((resolve) =>
      old.once('disconnect', resolve),
    );
    const replacement = await client();
    const restored = nextEvent(replacement, 'student:restored');
    replacement.emit('student:reconnect', {
      joinCode: participant.joinCode,
      participantId: participant.participantId,
      reconnectToken: participant.reconnectToken,
    });
    await restored;
    expect(await disconnected).toBe('io server disconnect');
    expect(
      sessions
        .getSession(teacher.session.sessionId)
        .participants.get(participant.participantId),
    ).toMatchObject({ connected: true, socketId: replacement.id });
  });

  it('exige el token secreto para reconectar al alumno y al profesor', async () => {
    const teacher = await createTeacher();
    const participant = await join(
      await client(),
      teacher.session.joinCode,
      'Ana',
    );
    const attacker = await client();
    const studentError = nextEvent(attacker, 'app:error');
    attacker.emit('student:reconnect', {
      joinCode: participant.joinCode,
      participantId: participant.participantId,
      reconnectToken: teacher.session.teacherToken,
    });
    expect(await studentError).toMatchObject({
      code: 'INVALID_RECONNECT_TOKEN',
    });
    const teacherError = nextEvent(attacker, 'app:error');
    attacker.emit('teacher:reconnect', {
      sessionId: teacher.session.sessionId,
      teacherToken: participant.reconnectToken,
    });
    expect(await teacherError).toMatchObject({ code: 'INVALID_TEACHER_TOKEN' });
    expect(teacher.socket.connected).toBe(true);
  });

  it('recupera la sala del profesor con el token y cierra su conexión anterior', async () => {
    const teacher = await createTeacher();
    await join(await client(), teacher.session.joinCode, 'Ana');
    const disconnected = new Promise<string>((resolve) =>
      teacher.socket.once('disconnect', resolve),
    );
    const newTeacher = await client();
    const restored = nextEvent(newTeacher, 'session:restored');
    newTeacher.emit('teacher:reconnect', {
      sessionId: teacher.session.sessionId,
      teacherToken: teacher.session.teacherToken,
    });
    expect(await restored).toMatchObject({
      sessionId: teacher.session.sessionId,
      joinCode: teacher.session.joinCode,
      lobby: { participants: [{ nick: 'Ana' }] },
    });
    expect(await disconnected).toBe('io server disconnect');
    const update = nextEvent(newTeacher, 'lobby:updated');
    await join(await client(), teacher.session.joinCode, 'Luis');
    expect((await update).participants).toHaveLength(2);
  });

  it('aísla las rooms de dos partidas simultáneas', async () => {
    const first = await createTeacher();
    const second = await createTeacher();
    const observer = vi.fn();
    second.socket.on('lobby:updated', observer);
    const update = nextEvent(first.socket, 'lobby:updated');
    await join(await client(), first.session.joinCode, 'Ana');
    await update;
    const secondUpdate = nextEvent(second.socket, 'lobby:updated');
    await join(await client(), second.session.joinCode, 'Luis');
    expect(
      (await secondUpdate).participants.map((entry) => entry.nick),
    ).toEqual(['Luis']);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(sessions.getSession(first.session.sessionId).participants.size).toBe(
      1,
    );
  });

  it('una conexión no puede crear ni entrar en otra partida después de incorporarse', async () => {
    const first = await createTeacher();
    const second = await createTeacher();
    const response = nextEvent(first.socket, 'app:error');
    first.socket.emit('student:join', {
      joinCode: second.session.joinCode,
      nick: 'Ana',
    });
    expect(await response).toMatchObject({ code: 'ALREADY_JOINED' });
    expect(
      sessions.getSession(second.session.sessionId).participants.size,
    ).toBe(0);
  });

  it('notifica caducidad, libera rooms y permite reutilizar conexiones y código sin arrastrar participantes', async () => {
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
    let now = 1000;
    sessions = new SessionService(repository, {
      now: () => now,
      joinCodeGenerator: () => 'ABC234',
    });
    application = createApplication({
      sessions,
      workbookStorage: storage,
      logger,
      config: readConfig({ SESSION_TTL_MINUTES: '1' }),
    });
    await listen();
    const teacher = await createTeacher();
    const pupil = await client();
    await join(pupil, teacher.session.joinCode, 'Ana');
    const teacherExpired = nextEvent(teacher.socket, 'session:expired');
    const pupilExpired = nextEvent(pupil, 'session:expired');
    now += 60_000;
    application.cleanupSessions();
    await Promise.all([teacherExpired, pupilExpired]);
    expect(repository.size).toBe(0);
    expect(
      application.io.sockets.adapter.rooms.has(
        `session:${teacher.session.sessionId}`,
      ),
    ).toBe(false);
    expect(
      application.io.sockets.adapter.rooms.has(
        `teacher:${teacher.session.sessionId}`,
      ),
    ).toBe(false);
    expect(teacher.socket.connected).toBe(true);
    const created = nextEvent(teacher.socket, 'session:created');
    teacher.socket.emit('teacher:create-session', {
      workbookReference: reference,
    });
    const next = await created;
    expect(next.joinCode).toBe(teacher.session.joinCode);
    expect(next.sessionId).not.toBe(teacher.session.sessionId);
    expect(next.lobby.participants).toEqual([]);
    const restored = await join(pupil, next.joinCode, 'Ana');
    expect(restored.lobby.participants).toHaveLength(1);
  });

  it('acota las descargas simultáneas y evita partidas huérfanas tras desconectar durante la carga', async () => {
    const releases: Array<(data: Buffer) => void> = [];
    const download = vi
      .spyOn(storage, 'downloadWorkbook')
      .mockImplementation(
        () => new Promise<Buffer>((resolve) => releases.push(resolve)),
      );
    const pending: Client[] = [];
    for (let index = 0; index < 4; index += 1) {
      const socket = await client();
      pending.push(socket);
      socket.emit('teacher:create-session', { workbookReference: reference });
    }
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(4));
    const fifth = await client();
    const rejected = nextEvent(fifth, 'app:error');
    fifth.emit('teacher:create-session', { workbookReference: reference });
    expect(await rejected).toMatchObject({ code: 'SERVER_BUSY' });
    expect(download).toHaveBeenCalledTimes(4);
    for (const socket of pending) socket.disconnect();
    await vi.waitFor(() => expect(application.io.sockets.sockets.size).toBe(1));
    for (const release of releases) release(data);
    await vi.waitFor(() =>
      expect(application.io.sockets.sockets.get(fifth.id!)?.data.busy).toBe(
        false,
      ),
    );
    expect(repository.size).toBe(0);
  });

  it('bloquea creaciones concurrentes desde el mismo socket', async () => {
    let release!: (buffer: Buffer) => void;
    vi.spyOn(storage, 'downloadWorkbook').mockImplementation(
      () =>
        new Promise<Buffer>((resolve) => {
          release = resolve;
        }),
    );
    const socket = await client();
    const created = nextEvent(socket, 'session:created');
    const error = nextEvent(socket, 'app:error');
    socket.emit('teacher:create-session', { workbookReference: reference });
    socket.emit('teacher:create-session', { workbookReference: reference });
    expect(await error).toMatchObject({ code: 'OPERATION_IN_PROGRESS' });
    release(data);
    await created;
    expect(repository.size).toBe(1);
  });

  it('no deja una sesión huérfana si el profesor se desconecta durante la descarga', async () => {
    let release!: (buffer: Buffer) => void;
    const download = vi
      .spyOn(storage, 'downloadWorkbook')
      .mockImplementationOnce(
        () =>
          new Promise<Buffer>((resolve) => {
            release = resolve;
          }),
      );
    const socket = await client();
    socket.emit('teacher:create-session', { workbookReference: reference });
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    socket.disconnect();
    await vi.waitFor(() => expect(application.io.sockets.sockets.size).toBe(0));
    release(data);
    await createTeacher();
    expect(repository.size).toBe(1);
    expect(
      logger.mock.calls.filter(([entry]) => entry.event === 'session_created'),
    ).toHaveLength(1);
  });

  it('limita la creación por IP aunque se utilicen sockets nuevos', async () => {
    for (let index = 0; index < 5; index += 1) await createTeacher();
    const socket = await client();
    const error = nextEvent(socket, 'app:error');
    socket.emit('teacher:create-session', { workbookReference: reference });
    expect(await error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(repository.size).toBe(5);
  });
});
