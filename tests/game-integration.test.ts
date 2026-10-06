import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/app.ts';
import { readConfig } from '../src/config/env.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  StudentSession,
  TeacherSession,
  TeacherControlPayload,
} from '../src/realtime/events.ts';
import { SessionService } from '../src/services/session-service.ts';
import { InMemoryWorkbookStorage } from './helpers/in-memory-workbook-storage.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type Payload<K extends keyof ServerToClientEvents> = Parameters<
  ServerToClientEvents[K]
>[0];
function nextEvent<K extends keyof ServerToClientEvents>(
  client: Client,
  event: K,
): Promise<Payload<K>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, listener as never);
      reject(new Error(`No se ha recibido ${event}.`));
    }, 2500);
    const listener = (payload: Payload<K>) => {
      clearTimeout(timer);
      resolve(payload);
    };
    client.once(event, listener as never);
  });
}

describe('Fase 6: juego completo por Socket.IO', () => {
  let application: ReturnType<typeof createApplication>;
  let sessions: SessionService;
  let storage: InMemoryWorkbookStorage;
  let clients: Client[];
  let now: number;
  let baseUrl: string;
  const logger = vi.fn();
  beforeEach(async () => {
    now = Date.now();
    clients = [];
    logger.mockClear();
    sessions = new SessionService(undefined, { now: () => now });
    storage = new InMemoryWorkbookStorage();
    await storage.uploadWorkbook(
      'Quiz/prueba.xlsx',
      await readFile(
        new URL('./fixtures/excel/valid-header.xlsx', import.meta.url),
      ),
    );
    application = createApplication({
      sessions,
      workbookStorage: storage,
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
    for (const socket of clients) socket.disconnect();
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
  const controls = (session: TeacherSession): TeacherControlPayload => ({
    sessionId: session.sessionId,
    teacherToken: session.teacherToken,
  });
  async function teacher() {
    const socket = await client();
    const created = nextEvent(socket, 'session:created');
    const synced = nextEvent(socket, 'game:updated');
    socket.emit('teacher:create-session', {
      workbookReference: 'Quiz/prueba.xlsx',
    });
    const session = await created;
    expect((await synced).state).toBe('LOBBY');
    return { socket, session };
  }
  async function student(session: TeacherSession, nick = 'Ana') {
    const socket = await client();
    const joined = nextEvent(socket, 'student:joined');
    const synced = nextEvent(socket, 'game:updated');
    socket.emit('student:join', { joinCode: session.joinCode, nick });
    const participant = await joined;
    await synced;
    return { socket, participant };
  }
  async function start(
    t: Awaited<ReturnType<typeof teacher>>,
    event:
      | 'teacher:start-game'
      | 'teacher:start-next-question' = 'teacher:start-game',
  ) {
    const started = nextEvent(t.socket, 'question:started');
    t.socket.emit(event, controls(t.session));
    return started;
  }
  async function close(t: Awaited<ReturnType<typeof teacher>>) {
    const closed = nextEvent(t.socket, 'question:ended');
    t.socket.emit('teacher:close-question', controls(t.session));
    return closed;
  }
  async function reconnect(s: StudentSession) {
    const socket = await client();
    const restored = nextEvent(socket, 'student:restored');
    const synced = nextEvent(socket, 'game:updated');
    socket.emit('student:reconnect', {
      joinCode: s.joinCode,
      participantId: s.participantId,
      reconnectToken: s.reconnectToken,
    });
    await restored;
    return { socket, snapshot: await synced };
  }

  it('crea, incorpora tres alumnos, pregunta, puntúa, avanza y termina sin modificar el XLSX', async () => {
    const upload = vi.spyOn(storage, 'uploadWorkbook');
    const t = await teacher();
    const a = await student(t.session);
    const b = await student(t.session, 'Luis');
    const c = await student(t.session, 'María');
    const privateEvents: unknown[] = [];
    a.socket.onAny((event, payload) => privateEvents.push({ event, payload }));
    const aStarted = nextEvent(a.socket, 'question:started');
    const bStarted = nextEvent(b.socket, 'question:started');
    const progress = nextEvent(t.socket, 'question:progress');
    const question = await start(t);
    expect(await aStarted).toEqual(question);
    expect(await bStarted).toEqual(question);
    expect(await progress).toMatchObject({
      answeredCount: 0,
      participantCount: 3,
    });
    const correct = question.options.find((option) => option.text === '4')!;
    now += 5000;
    const accepted = nextEvent(a.socket, 'answer:accepted');
    const update = nextEvent(t.socket, 'question:progress');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: correct.id,
    });
    expect(await accepted).toEqual({
      questionId: question.questionId,
      answerOptionId: correct.id,
    });
    expect(await update).toMatchObject({
      answeredCount: 1,
      participantCount: 3,
    });
    expect(JSON.stringify(privateEvents)).not.toMatch(
      /isCorrect|correctOptionId|correctAnswer|elapsedMs|teacherToken|reconnectToken/,
    );
    const wrongAccepted = nextEvent(b.socket, 'answer:accepted');
    b.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options.find(
        (option) => option.id !== correct.id,
      )!.id,
    });
    await wrongAccepted;
    const ownResult = nextEvent(a.socket, 'student:result');
    const noAnswer = nextEvent(c.socket, 'student:result');
    const ranking = nextEvent(t.socket, 'ranking:updated');
    expect(await close(t)).toMatchObject({
      correctOptionId: correct.id,
      correctCount: 1,
      answeredCount: 2,
      participantCount: 3,
      hasNextQuestion: true,
    });
    expect(await ownResult).toMatchObject({
      isCorrect: true,
      elapsedMs: 5000,
      points: 750,
      totalPoints: 750,
      position: 1,
    });
    expect(await noAnswer).toMatchObject({
      answered: false,
      elapsedMs: 20000,
      points: 0,
      position: 3,
    });
    expect((await ranking).map((entry) => entry.nick)).toEqual([
      'Ana',
      'Luis',
      'María',
    ]);
    const second = await start(t, 'teacher:start-next-question');
    expect(second).toMatchObject({ questionNumber: 2, questionCount: 2 });
    const secondAnswer = nextEvent(a.socket, 'answer:accepted');
    a.socket.emit('student:answer', {
      questionId: second.questionId,
      answerOptionId: second.options.find((option) => option.text === 'Marte')!
        .id,
    });
    await secondAnswer;
    expect(await close(t)).toMatchObject({ hasNextQuestion: false });
    const finished = nextEvent(a.socket, 'game:ended');
    t.socket.emit('teacher:end-game', controls(t.session));
    const final = await finished;
    expect(final.podium).toHaveLength(3);
    expect(final.ranking[0]).toMatchObject({
      nick: 'Ana',
      totalPoints: 1750,
      position: 1,
    });
    expect(
      sessions.getSession(t.session.sessionId).completedRounds,
    ).toHaveLength(2);
    expect(upload).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      t.session.teacherToken,
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      a.participant.reconnectToken,
    );
    expect(logger.mock.calls.map(([entry]) => entry.event)).toEqual(
      expect.arrayContaining([
        'question_started',
        'question_closed',
        'session_finished',
      ]),
    );
  });

  it('ignora la segunda respuesta, rechaza opciones inexistentes y payloads con tiempos del cliente', async () => {
    const t = await teacher();
    const a = await student(t.session);
    const question = await start(t);
    const invalid = nextEvent(a.socket, 'app:error');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: randomUUID(),
    });
    expect(await invalid).toMatchObject({ code: 'INVALID_ANSWER_OPTION' });
    const extra = nextEvent(a.socket, 'app:error');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options[0]!.id,
      elapsedMs: 0,
    } as Parameters<ClientToServerEvents['student:answer']>[0]);
    expect(await extra).toMatchObject({ code: 'INVALID_PAYLOAD' });
    const first = question.options.find((entry) => entry.text === '4')!;
    let accepted = nextEvent(a.socket, 'answer:accepted');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: first.id,
    });
    await accepted;
    accepted = nextEvent(a.socket, 'answer:accepted');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options.find((entry) => entry.id !== first.id)!
        .id,
    });
    expect(await accepted).toMatchObject({ answerOptionId: first.id });
    const outcome = nextEvent(a.socket, 'student:result');
    await close(t);
    expect(await outcome).toMatchObject({ isCorrect: true, points: 1000 });
    const late = nextEvent(a.socket, 'app:error');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: first.id,
    });
    expect(await late).toMatchObject({ code: 'QUESTION_NOT_ACTIVE' });
    const repeatClose = nextEvent(t.socket, 'app:error');
    t.socket.emit('teacher:close-question', controls(t.session));
    expect(await repeatClose).toMatchObject({ code: 'QUESTION_NOT_ACTIVE' });
    expect(
      sessions
        .getSession(t.session.sessionId)
        .participants.get(a.participant.participantId)?.totalPoints,
    ).toBe(1000);
  });

  it('cierra automáticamente por tiempo y espera al profesor antes de continuar', async () => {
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
    application = createApplication({
      config: readConfig({
        DEFAULT_QUESTION_DURATION_SECONDS: '1',
        MAX_POINTS_PER_QUESTION: '2000',
      }),
      workbookStorage: storage,
      logger,
    });
    await listen();
    const t = await teacher();
    const a = await student(t.session);
    const ended = nextEvent(t.socket, 'question:ended');
    const own = nextEvent(a.socket, 'student:result');
    const question = await start(t);
    expect(question.durationMs).toBe(1000);
    expect(await ended).toMatchObject({ questionNumber: 1, answeredCount: 0 });
    expect(await own).toMatchObject({
      answered: false,
      elapsedMs: 1000,
      points: 0,
    });
    const newTeacher = await client();
    const synced = nextEvent(newTeacher, 'game:updated');
    newTeacher.emit('teacher:reconnect', controls(t.session));
    expect(await synced).toMatchObject({
      state: 'QUESTION_RESULTS',
      question: { questionNumber: 1 },
    });
  });

  it('rechaza una respuesta al alcanzar el plazo aunque llegue antes del callback del temporizador', async () => {
    const t = await teacher();
    const a = await student(t.session);
    const question = await start(t);
    now = question.endsAt;
    const ended = nextEvent(t.socket, 'question:ended');
    const error = nextEvent(a.socket, 'app:error');
    a.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options[0]!.id,
    });
    expect(await error).toMatchObject({ code: 'QUESTION_NOT_ACTIVE' });
    expect(await ended).toMatchObject({ answeredCount: 0 });
    expect(
      sessions.getSession(t.session.sessionId).completedRounds,
    ).toHaveLength(1);
  });

  it('recupera la misma pregunta, la respuesta enviada, los resultados y el podio al reconectar', async () => {
    const t = await teacher();
    const a = await student(t.session);
    const question = await start(t);
    let restored = await reconnect(a.participant);
    expect(restored.snapshot).toMatchObject({
      state: 'QUESTION_ACTIVE',
      question,
      self: { hasAnswered: false },
    });
    const accepted = nextEvent(restored.socket, 'answer:accepted');
    restored.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options.find((entry) => entry.text === '4')!.id,
    });
    await accepted;
    restored = await reconnect(a.participant);
    expect(restored.snapshot.self).toMatchObject({
      hasAnswered: true,
      result: null,
    });
    expect(JSON.stringify(restored.snapshot)).not.toMatch(
      /correctOptionId|isCorrect|correctAnswer/,
    );
    const teacherSocket = await client();
    const teacherSynced = nextEvent(teacherSocket, 'game:updated');
    teacherSocket.emit('teacher:reconnect', controls(t.session));
    expect(await teacherSynced).toMatchObject({
      state: 'QUESTION_ACTIVE',
      question,
      progress: { answeredCount: 1 },
    });
    await close({ socket: teacherSocket, session: t.session });
    restored = await reconnect(a.participant);
    expect(restored.snapshot).toMatchObject({
      state: 'QUESTION_RESULTS',
      self: { result: { points: 1000, totalPoints: 1000, position: 1 } },
    });
    const finished = nextEvent(teacherSocket, 'game:ended');
    teacherSocket.emit('teacher:end-game', controls(t.session));
    await finished;
    restored = await reconnect(a.participant);
    expect(restored.snapshot).toMatchObject({
      state: 'FINISHED',
      podium: [{ nick: 'Ana', totalPoints: 1000 }],
    });
  });

  it('autoriza profesor y alumno, valida controles y evita saltos de estado', async () => {
    const t = await teacher();
    const a = await student(t.session);
    const outsider = await client();
    for (const socket of [a.socket, outsider]) {
      const error = nextEvent(socket, 'app:error');
      socket.emit('teacher:start-game', controls(t.session));
      expect(await error).toMatchObject({ code: 'FORBIDDEN' });
    }
    let error = nextEvent(t.socket, 'app:error');
    t.socket.emit('teacher:start-game', {
      ...controls(t.session),
      teacherToken: a.participant.reconnectToken,
    });
    expect(await error).toMatchObject({ code: 'INVALID_TEACHER_TOKEN' });
    error = nextEvent(t.socket, 'app:error');
    t.socket.emit(
      'teacher:start-game',
      null as unknown as TeacherControlPayload,
    );
    expect(await error).toMatchObject({ code: 'INVALID_PAYLOAD' });
    const question = await start(t);
    for (const event of [
      'teacher:start-game',
      'teacher:start-next-question',
      'teacher:end-game',
    ] as const) {
      error = nextEvent(t.socket, 'app:error');
      t.socket.emit(event, controls(t.session));
      expect(await error).toMatchObject({ code: 'INVALID_TRANSITION' });
    }
    error = nextEvent(t.socket, 'app:error');
    t.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options[0]!.id,
    });
    expect(await error).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('aísla preguntas, respuestas, cierre y final entre partidas simultáneas', async () => {
    const first = await teacher();
    const second = await teacher();
    const a = await student(first.session);
    const b = await student(second.session, 'Luis');
    const observers = [vi.fn(), vi.fn()];
    for (const event of [
      'question:started',
      'question:ended',
      'ranking:updated',
      'game:ended',
    ] as const) {
      second.socket.on(event, observers[0]!);
      b.socket.on(event, observers[1]!);
    }
    const question = await start(first);
    const foreignControl = nextEvent(first.socket, 'app:error');
    first.socket.emit('teacher:close-question', controls(second.session));
    expect(await foreignControl).toMatchObject({ code: 'FORBIDDEN' });
    const foreignAnswer = nextEvent(b.socket, 'app:error');
    b.socket.emit('student:answer', {
      questionId: question.questionId,
      answerOptionId: question.options[0]!.id,
    });
    expect(await foreignAnswer).toMatchObject({ code: 'QUESTION_NOT_ACTIVE' });
    await close(first);
    const ended = nextEvent(a.socket, 'game:ended');
    first.socket.emit('teacher:end-game', controls(first.session));
    await ended;
    const restored = await reconnect(b.participant); // Barrera de eventos, sin sleeps.
    expect(restored.snapshot.state).toBe('LOBBY');
    for (const observer of observers) expect(observer).not.toHaveBeenCalled();
  });

  it('permite dos rondas con 40 alumnos en la misma IP y envía resultados individuales', async () => {
    const t = await teacher();
    const students = [];
    for (let index = 0; index < 40; index += 1)
      students.push(await student(t.session, `Alumno ${index + 1}`));
    for (const event of [
      'teacher:start-game',
      'teacher:start-next-question',
    ] as const) {
      const question = await start(t, event);
      const option = question.options[0]!;
      const answers = students.map(({ socket }) =>
        nextEvent(socket, 'answer:accepted'),
      );
      for (const { socket } of students)
        socket.emit('student:answer', {
          questionId: question.questionId,
          answerOptionId: option.id,
        });
      expect(await Promise.all(answers)).toHaveLength(40);
      const results = students.map(({ socket }) =>
        nextEvent(socket, 'student:result'),
      );
      expect(await close(t)).toMatchObject({
        answeredCount: 40,
        participantCount: 40,
      });
      const individual = await Promise.all(results);
      for (let index = 0; index < individual.length; index += 1)
        expect(individual[index]?.participantId).toBe(
          students[index]?.participant.participantId,
        );
    }
  });
});
