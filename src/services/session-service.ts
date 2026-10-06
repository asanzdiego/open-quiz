import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';
import {
  generateJoinCode,
  generateSecretToken,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  tokensMatch,
} from '../domain/identifiers.ts';
import {
  normalizeNick,
  type Participant,
} from '../domain/participant/participant.ts';
import { InMemorySessionRepository } from '../domain/session/in-memory-session-repository.ts';
import {
  createQuestionRound,
  type RoundResult,
  type ResultPersistence,
} from '../domain/question/round.ts';
import { calculatePoints } from '../domain/scoring/calculate-points.ts';
import { getGameSnapshot, type GameSnapshot } from '../domain/session/game.ts';
import {
  assertSessionTransition,
  type Session,
  type SessionState,
  type SessionWorkbook,
} from '../domain/session/session.ts';

interface SessionServiceOptions {
  now?: () => number;
  joinCodeGenerator?: () => string;
  questionDurationMs?: number;
  maxPointsPerQuestion?: number;
}

interface SessionCleanupOptions {
  sessionTtlMs: number;
  finishedSessionTtlMs: number;
}

export class SessionService {
  readonly #repository: InMemorySessionRepository;
  readonly #now: () => number;
  readonly #joinCodeGenerator: () => string;
  readonly #questionDurationMs: number;
  readonly #maxPointsPerQuestion: number;

  constructor(
    repository = new InMemorySessionRepository(),
    options: SessionServiceOptions = {},
  ) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
    this.#joinCodeGenerator = options.joinCodeGenerator ?? generateJoinCode;
    this.#questionDurationMs = options.questionDurationMs ?? 20_000;
    this.#maxPointsPerQuestion = options.maxPointsPerQuestion ?? 1000;
    if (
      !Number.isSafeInteger(this.#questionDurationMs) ||
      this.#questionDurationMs < 1 ||
      this.#questionDurationMs > 3_600_000
    )
      throw new RangeError(
        'La duración debe estar entre 1 y 3600000 milisegundos.',
      );
    if (
      !Number.isSafeInteger(this.#maxPointsPerQuestion) ||
      this.#maxPointsPerQuestion < 0 ||
      this.#maxPointsPerQuestion > 1_000_000
    )
      throw new RangeError('El máximo debe estar entre 0 y 1000000 puntos.');
  }

  createSession(workbook?: SessionWorkbook): Session {
    let joinCode: string | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = this.#joinCodeGenerator();
      if (
        candidate.length !== JOIN_CODE_LENGTH ||
        [...candidate].some(
          (character) => !JOIN_CODE_ALPHABET.includes(character),
        )
      ) {
        throw new DomainError(
          'JOIN_CODE_UNAVAILABLE',
          'No se ha podido generar un código de partida válido.',
        );
      }
      if (!this.#repository.getByJoinCode(candidate)) {
        joinCode = candidate;
        break;
      }
    }

    if (joinCode === undefined) {
      throw new DomainError(
        'JOIN_CODE_UNAVAILABLE',
        'No se ha podido generar un código de partida libre.',
      );
    }

    const now = this.#now();
    const session: Session = {
      id: randomUUID(),
      joinCode,
      teacherToken: generateSecretToken(),
      state: 'LOBBY',
      workbookReference: workbook?.reference ?? null,
      questions: structuredClone(workbook?.questions ?? []),
      currentQuestionIndex: -1,
      currentRound: null,
      completedRounds: [],
      participants: new Map(),
      createdAt: now,
      lastActivityAt: now,
      finishedAt: null,
    };

    this.#repository.add(session);
    return structuredClone(session);
  }

  getSession(id: string): Session {
    return structuredClone(this.#requireSession(id));
  }

  getSessionByJoinCode(joinCode: string): Session {
    return structuredClone(this.#requireSessionByCode(joinCode));
  }

  reconnectTeacher(id: string, teacherToken: string): Session {
    const session = this.#requireSession(id);
    this.#authorizeTeacher(session, teacherToken);
    session.lastActivityAt = this.#now();
    return structuredClone(session);
  }

  transitionSession(
    id: string,
    teacherToken: string,
    nextState: SessionState,
  ): Session {
    const session = this.#requireSession(id);
    this.#authorizeTeacher(session, teacherToken);
    assertSessionTransition(session.state, nextState);

    if (nextState === 'QUESTION_ACTIVE')
      return session.state === 'LOBBY'
        ? this.startGame(id, teacherToken)
        : this.startNextQuestion(id, teacherToken);
    if (nextState === 'QUESTION_RESULTS')
      return this.closeQuestion(id, teacherToken);
    return this.endGame(id, teacherToken);
  }

  getGameSnapshot(id: string, participantId?: string): GameSnapshot {
    return getGameSnapshot(
      this.#requireSession(id),
      this.#now(),
      participantId,
    );
  }

  startGame(id: string, teacherToken: string): Session {
    const session = this.#requireSession(id);
    this.#authorizeTeacher(session, teacherToken);
    if (session.state !== 'LOBBY')
      throw new DomainError(
        'INVALID_TRANSITION',
        'La partida ya ha empezado o ha terminado.',
      );
    if (session.questions.length === 0)
      throw new DomainError('NO_QUESTIONS', 'La partida no tiene preguntas.');
    return this.#startQuestion(session);
  }

  startNextQuestion(id: string, teacherToken: string): Session {
    const session = this.#requireSession(id);
    this.#authorizeTeacher(session, teacherToken);
    if (session.state !== 'QUESTION_RESULTS')
      throw new DomainError(
        'INVALID_TRANSITION',
        'Cierra la pregunta antes de pasar a la siguiente.',
      );
    if (session.currentQuestionIndex + 1 >= session.questions.length)
      throw new DomainError(
        'NO_MORE_QUESTIONS',
        'No quedan preguntas. Puedes finalizar la partida.',
      );
    this.#assertResultsSaved(session);
    return this.#startQuestion(session);
  }

  #startQuestion(session: Session): Session {
    const index = session.currentQuestionIndex + 1;
    const now = this.#now();
    session.currentRound = createQuestionRound(
      session.questions[index]!,
      index + 1,
      [...session.participants.keys()],
      now,
      this.#questionDurationMs,
    );
    session.currentQuestionIndex = index;
    session.state = 'QUESTION_ACTIVE';
    session.lastActivityAt = now;
    return structuredClone(session);
  }

  submitAnswer(
    id: string,
    participantId: string,
    socketId: string,
    questionId: string,
    answerOptionId: string,
  ): { questionId: string; answerOptionId: string; accepted: boolean } {
    const session = this.#requireSession(id);
    const participant = this.#requireParticipant(session, participantId);
    if (!participant.connected || participant.socketId !== socketId)
      throw new DomainError(
        'PARTICIPANT_NOT_CONNECTED',
        'Tu conexión ya no está activa. Vuelve a conectar.',
      );
    const round = session.currentRound;
    if (session.state !== 'QUESTION_ACTIVE' || !round)
      throw new DomainError(
        'QUESTION_NOT_ACTIVE',
        'La pregunta no está abierta.',
      );
    if (round.questionId !== questionId)
      throw new DomainError(
        'QUESTION_MISMATCH',
        'La respuesta no corresponde a la pregunta actual.',
      );
    const now = this.#now();
    if (now >= round.endsAt)
      throw new DomainError('QUESTION_EXPIRED', 'La pregunta ya ha terminado.');
    if (!round.options.some((option) => option.id === answerOptionId))
      throw new DomainError(
        'INVALID_ANSWER_OPTION',
        'La opción de respuesta no existe.',
      );
    const previous = round.answers.get(participantId);
    if (previous)
      return {
        questionId,
        answerOptionId: previous.answerOptionId,
        accepted: false,
      };
    round.answers.set(participantId, {
      answerOptionId,
      elapsedMs: Math.max(0, now - round.startedAt),
    });
    session.lastActivityAt = now;
    return { questionId, answerOptionId, accepted: true };
  }

  closeQuestion(id: string, teacherToken: string): Session {
    const session = this.#requireSession(id);
    this.#authorizeTeacher(session, teacherToken);
    return this.#closeQuestion(session);
  }

  remainingQuestionTime(id: string): number | null {
    const session = this.#requireSession(id);
    return session.state === 'QUESTION_ACTIVE' && session.currentRound
      ? Math.max(0, session.currentRound.endsAt - this.#now())
      : null;
  }

  closeExpiredQuestion(id: string): Session | null {
    const session = this.#requireSession(id);
    return this.remainingQuestionTime(id) === 0
      ? this.#closeQuestion(session)
      : null;
  }

  #closeQuestion(session: Session): Session {
    const round = session.currentRound;
    if (session.state !== 'QUESTION_ACTIVE' || !round)
      throw new DomainError(
        'QUESTION_NOT_ACTIVE',
        'La pregunta no está abierta.',
      );
    const result: RoundResult = {
      persistence: { status: 'pending', error: null },
      questionId: round.questionId,
      questionNumber: round.questionNumber,
      correctOptionId: round.correctOptionId,
      correctAnswer: round.options.find(
        (option) => option.id === round.correctOptionId,
      )!.text,
      participants: round.participantIds.map((participantId) => {
        const participant = this.#requireParticipant(session, participantId);
        const answer = round.answers.get(participantId);
        const isCorrect = answer?.answerOptionId === round.correctOptionId;
        const elapsedMs = answer?.elapsedMs ?? round.durationMs;
        const points = calculatePoints({
          isCorrect,
          elapsedMs,
          durationMs: round.durationMs,
          maxPoints: this.#maxPointsPerQuestion,
        });
        participant.totalPoints += points;
        return {
          participantId,
          nick: participant.nick,
          answered: Boolean(answer),
          isCorrect,
          elapsedMs,
          points,
          totalPoints: participant.totalPoints,
        };
      }),
    };
    session.completedRounds.push(result);
    session.state = 'QUESTION_RESULTS';
    session.lastActivityAt = this.#now();
    return structuredClone(session);
  }

  endGame(id: string, teacherToken: string): Session {
    const session = this.#requireSession(id);
    this.#authorizeTeacher(session, teacherToken);
    assertSessionTransition(session.state, 'FINISHED');
    this.#assertResultsSaved(session);
    session.state = 'FINISHED';
    session.finishedAt = this.#now();
    session.lastActivityAt = session.finishedAt;
    return structuredClone(session);
  }

  /** Uso interno del servicio de escritura, nunca acepta payloads del navegador. */
  setResultPersistence(
    id: string,
    questionId: string,
    persistence: ResultPersistence,
  ): void {
    const session = this.#requireSession(id);
    const result = session.completedRounds.find(
      (round) => round.questionId === questionId,
    );
    if (!result)
      throw new DomainError(
        'RESULT_NOT_FOUND',
        'No hay resultados para guardar.',
      );
    result.persistence = structuredClone(persistence);
    session.lastActivityAt = this.#now();
  }

  #assertResultsSaved(session: Session): void {
    if (
      session.completedRounds.some(
        (round) => round.persistence.status !== 'saved',
      )
    )
      throw new DomainError(
        'RESULTS_NOT_SAVED',
        'Guarda los resultados pendientes en Nextcloud antes de continuar o finalizar la partida.',
      );
  }

  joinSession(joinCode: string, nick: string, socketId: string): Participant {
    const session = this.#requireSessionByCode(joinCode);
    if (session.state !== 'LOBBY') {
      throw new DomainError(
        'SESSION_NOT_IN_LOBBY',
        'La partida ya ha empezado o ha terminado.',
      );
    }

    const normalizedNick = normalizeNick(nick);
    for (const participant of session.participants.values()) {
      if (participant.nick.toLowerCase() === normalizedNick.toLowerCase()) {
        throw new DomainError(
          'NICK_TAKEN',
          'Ese nick ya está siendo utilizado.',
        );
      }
    }
    this.#validateSocketId(socketId);

    const participant: Participant = {
      id: randomUUID(),
      nick: normalizedNick,
      reconnectToken: generateSecretToken(),
      socketId,
      connected: true,
      totalPoints: 0,
    };
    session.participants.set(participant.id, participant);
    session.lastActivityAt = this.#now();
    return { ...participant };
  }

  reconnectParticipant(
    joinCode: string,
    participantId: string,
    reconnectToken: string,
    socketId: string,
  ): Participant {
    const session = this.#requireSessionByCode(joinCode);
    const participant = this.#requireParticipant(session, participantId);
    if (!tokensMatch(participant.reconnectToken, reconnectToken)) {
      throw new DomainError(
        'INVALID_RECONNECT_TOKEN',
        'No se ha podido recuperar tu participante.',
      );
    }
    this.#validateSocketId(socketId);

    participant.socketId = socketId;
    participant.connected = true;
    session.lastActivityAt = this.#now();
    return { ...participant };
  }

  disconnectParticipant(
    sessionId: string,
    participantId: string,
    socketId: string,
  ): boolean {
    const session = this.#requireSession(sessionId);
    const participant = this.#requireParticipant(session, participantId);
    // Un disconnect tardío del socket anterior no debe invalidar la reconexión.
    if (participant.socketId !== socketId) return false;

    participant.socketId = null;
    participant.connected = false;
    session.lastActivityAt = this.#now();
    return true;
  }

  cleanupExpired({
    sessionTtlMs,
    finishedSessionTtlMs,
  }: SessionCleanupOptions): number {
    for (const ttl of [sessionTtlMs, finishedSessionTtlMs]) {
      if (!Number.isSafeInteger(ttl) || ttl <= 0) {
        throw new RangeError(
          'El TTL debe ser un entero positivo de milisegundos.',
        );
      }
    }

    const now = this.#now();
    let deleted = 0;
    for (const session of this.#repository.values()) {
      // No eliminar una sesión mientras su libro se está descargando o subiendo.
      if (
        session.completedRounds.some(
          (round) => round.persistence.status === 'saving',
        )
      )
        continue;
      const expired =
        session.state === 'FINISHED'
          ? now - (session.finishedAt ?? session.lastActivityAt) >=
            finishedSessionTtlMs
          : now - session.lastActivityAt >= sessionTtlMs;
      if (expired && this.#repository.delete(session.id)) deleted += 1;
    }
    return deleted;
  }

  #requireSession(id: string): Session {
    const session = this.#repository.getById(id);
    if (!session)
      throw new DomainError('SESSION_NOT_FOUND', 'La partida no existe.');
    return session;
  }

  #requireSessionByCode(joinCode: string): Session {
    const session = this.#repository.getByJoinCode(joinCode);
    if (!session)
      throw new DomainError(
        'SESSION_NOT_FOUND',
        'El código de partida no existe.',
      );
    return session;
  }

  #requireParticipant(session: Session, id: string): Participant {
    const participant = session.participants.get(id);
    if (!participant)
      throw new DomainError(
        'PARTICIPANT_NOT_FOUND',
        'El participante no existe en esta partida.',
      );
    return participant;
  }

  #authorizeTeacher(session: Session, teacherToken: string): void {
    if (!tokensMatch(session.teacherToken, teacherToken)) {
      throw new DomainError(
        'INVALID_TEACHER_TOKEN',
        'No tienes permiso para controlar esta partida.',
      );
    }
  }

  #validateSocketId(socketId: string): void {
    if (socketId.trim().length === 0) {
      throw new DomainError(
        'INVALID_SOCKET_ID',
        'No se ha podido identificar la conexión.',
      );
    }
  }
}
