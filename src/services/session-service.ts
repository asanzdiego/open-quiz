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
  assertSessionTransition,
  type Session,
  type SessionState,
  type SessionWorkbook,
} from '../domain/session/session.ts';

interface SessionServiceOptions {
  now?: () => number;
  joinCodeGenerator?: () => string;
}

interface SessionCleanupOptions {
  sessionTtlMs: number;
  finishedSessionTtlMs: number;
}

export class SessionService {
  readonly #repository: InMemorySessionRepository;
  readonly #now: () => number;
  readonly #joinCodeGenerator: () => string;

  constructor(
    repository = new InMemorySessionRepository(),
    options: SessionServiceOptions = {},
  ) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
    this.#joinCodeGenerator = options.joinCodeGenerator ?? generateJoinCode;
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

    session.state = nextState;
    session.lastActivityAt = this.#now();
    if (nextState === 'FINISHED') session.finishedAt = session.lastActivityAt;
    return structuredClone(session);
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
