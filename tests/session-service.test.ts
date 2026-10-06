import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError, type DomainErrorCode } from '../src/domain/errors.ts';
import { MAX_NICK_LENGTH } from '../src/domain/participant/participant.ts';
import { InMemorySessionRepository } from '../src/domain/session/in-memory-session-repository.ts';
import { type SessionState } from '../src/domain/session/session.ts';
import { SessionService } from '../src/services/session-service.ts';
import { gameWorkbook } from './helpers/game-fixture.ts';

function expectDomainError(action: () => unknown, code: DomainErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code });
    return;
  }
  expect.fail(`Se esperaba el error ${code}.`);
}

describe('Servicio de sesiones', () => {
  let repository: InMemorySessionRepository;
  let service: SessionService;
  let now: number;

  beforeEach(() => {
    now = 1000;
    repository = new InMemorySessionRepository();
    service = new SessionService(repository, { now: () => now });
  });

  it('crea sesiones en LOBBY con UUID, código y token de profesor independientes', () => {
    const first = service.createSession(gameWorkbook);
    const second = service.createSession(gameWorkbook);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.teacherToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).toBe('LOBBY');
    expect(first.createdAt).toBe(1000);
    expect(first.lastActivityAt).toBe(1000);
    expect(first.finishedAt).toBeNull();
    expect(first.participants.size).toBe(0);
    expect(first.id).not.toBe(second.id);
    expect(first.joinCode).not.toBe(second.joinCode);
    expect(first.teacherToken).not.toBe(second.teacherToken);
    expect(repository.size).toBe(2);
  });

  it('regenera un código cuando colisiona con una sesión existente', () => {
    const generator = vi
      .fn()
      .mockReturnValueOnce('ABC234')
      .mockReturnValueOnce('ABC234')
      .mockReturnValueOnce('DEF567');
    service = new SessionService(repository, { joinCodeGenerator: generator });
    const first = service.createSession(gameWorkbook);
    const second = service.createSession(gameWorkbook);
    expect(first.joinCode).toBe('ABC234');
    expect(second.joinCode).toBe('DEF567');
    expect(generator).toHaveBeenCalledTimes(3);
    expect(repository.size).toBe(2);
  });

  it('falla de forma acotada si no se puede generar un código libre', () => {
    service = new SessionService(repository, {
      joinCodeGenerator: () => 'ABC234',
    });
    service.createSession(gameWorkbook);
    expectDomainError(
      () => service.createSession(gameWorkbook),
      'JOIN_CODE_UNAVAILABLE',
    );
    expect(repository.size).toBe(1);
  });

  it('rechaza un generador que devuelve códigos fuera del formato', () => {
    service = new SessionService(repository, {
      joinCodeGenerator: () => 'OOOOOO',
    });
    expectDomainError(
      () => service.createSession(gameWorkbook),
      'JOIN_CODE_UNAVAILABLE',
    );
    expect(repository.size).toBe(0);
  });

  it('recorre los estados sin avanzar automáticamente y conserva la fecha de finalización', () => {
    const session = service.createSession(gameWorkbook);
    const states: SessionState[] = [
      'QUESTION_ACTIVE',
      'QUESTION_RESULTS',
      'QUESTION_ACTIVE',
      'QUESTION_RESULTS',
      'FINISHED',
    ];
    for (const state of states) {
      now += 100;
      const updated = service.transitionSession(
        session.id,
        session.teacherToken,
        state,
      );
      expect(updated.state).toBe(state);
      expect(updated.lastActivityAt).toBe(now);
      expect(updated.finishedAt).toBe(state === 'FINISHED' ? now : null);
    }
    expect(service.getSession(session.id).state).toBe('FINISHED');
  });

  it('permite terminar una sala de espera', () => {
    const session = service.createSession(gameWorkbook);
    expect(
      service.transitionSession(session.id, session.teacherToken, 'FINISHED')
        .state,
    ).toBe('FINISHED');
  });

  it('rechaza saltos, transiciones repetidas y la reapertura de una partida terminada', () => {
    const session = service.createSession(gameWorkbook);
    const transition = (state: SessionState) =>
      service.transitionSession(session.id, session.teacherToken, state);
    expectDomainError(
      () => transition('QUESTION_RESULTS'),
      'INVALID_TRANSITION',
    );
    expectDomainError(() => transition('LOBBY'), 'INVALID_TRANSITION');
    transition('QUESTION_ACTIVE');
    expectDomainError(() => transition('FINISHED'), 'INVALID_TRANSITION');
    expectDomainError(
      () => transition('QUESTION_ACTIVE'),
      'INVALID_TRANSITION',
    );
    expect(service.getSession(session.id).state).toBe('QUESTION_ACTIVE');
    transition('QUESTION_RESULTS');
    expectDomainError(() => transition('LOBBY'), 'INVALID_TRANSITION');
    transition('FINISHED');
    expectDomainError(
      () => transition('QUESTION_ACTIVE'),
      'INVALID_TRANSITION',
    );
  });

  it('exige el token del profesor de esa sesión, y el código de acceso no sirve como secreto', () => {
    const first = service.createSession(gameWorkbook);
    const second = service.createSession(gameWorkbook);
    for (const token of ['', first.joinCode, second.teacherToken]) {
      expectDomainError(
        () => service.transitionSession(first.id, token, 'QUESTION_ACTIVE'),
        'INVALID_TEACHER_TOKEN',
      );
    }
    expect(service.getSession(first.id).state).toBe('LOBBY');
  });

  it('incorpora participantes con nick recortado, UUID y token propio', () => {
    const session = service.createSession(gameWorkbook);
    now = 1500;
    const participant = service.joinSession(
      ` ${session.joinCode.toLowerCase()} `,
      '  Ana  ',
      'socket-1',
    );
    expect(participant).toMatchObject({
      nick: 'Ana',
      socketId: 'socket-1',
      connected: true,
      totalPoints: 0,
    });
    expect(participant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(participant.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(participant.reconnectToken).not.toBe(session.teacherToken);
    expect(service.getSession(session.id).lastActivityAt).toBe(1500);
  });

  it.each(['', '   ', 'a'.repeat(MAX_NICK_LENGTH + 1), 'Ana\u0000María'])(
    'rechaza el nick inválido %j sin crear participante',
    (nick) => {
      const session = service.createSession(gameWorkbook);
      expectDomainError(
        () => service.joinSession(session.joinCode, nick, 'socket-1'),
        'INVALID_NICK',
      );
      expect(service.getSession(session.id).participants.size).toBe(0);
    },
  );

  it('acepta el límite del nick y cuenta caracteres Unicode completos', () => {
    const session = service.createSession(gameWorkbook);
    expect(
      service.joinSession(
        session.joinCode,
        '🦉'.repeat(MAX_NICK_LENGTH),
        'socket-1',
      ).nick,
    ).toHaveLength(MAX_NICK_LENGTH * 2);
  });

  it('rechaza nicks duplicados sin distinguir mayúsculas o representación Unicode', () => {
    const session = service.createSession(gameWorkbook);
    service.joinSession(session.joinCode, 'José', 'socket-1');
    expectDomainError(
      () => service.joinSession(session.joinCode, ' JOSÉ ', 'socket-2'),
      'NICK_TAKEN',
    );
    expectDomainError(
      () => service.joinSession(session.joinCode, 'Jose\u0301', 'socket-2'),
      'NICK_TAKEN',
    );
  });

  it('reserva también el nick de un participante desconectado', () => {
    const session = service.createSession(gameWorkbook);
    const participant = service.joinSession(
      session.joinCode,
      'Ana',
      'socket-1',
    );
    service.disconnectParticipant(session.id, participant.id, 'socket-1');
    expectDomainError(
      () => service.joinSession(session.joinCode, 'ana', 'socket-2'),
      'NICK_TAKEN',
    );
  });

  it('mantiene aislados los participantes y los estados de varias partidas', () => {
    const first = service.createSession(gameWorkbook);
    const second = service.createSession(gameWorkbook);
    const firstParticipant = service.joinSession(
      first.joinCode,
      'Ana',
      'socket-1',
    );
    const secondParticipant = service.joinSession(
      second.joinCode,
      'Ana',
      'socket-2',
    );
    service.transitionSession(first.id, first.teacherToken, 'QUESTION_ACTIVE');
    expect(service.getSession(first.id).participants.size).toBe(1);
    expect(service.getSession(second.id).state).toBe('LOBBY');
    expect(
      service.getSession(second.id).participants.has(firstParticipant.id),
    ).toBe(false);
    expect(firstParticipant.id).not.toBe(secondParticipant.id);
    expectDomainError(
      () =>
        service.reconnectParticipant(
          second.joinCode,
          firstParticipant.id,
          firstParticipant.reconnectToken,
          'socket-3',
        ),
      'PARTICIPANT_NOT_FOUND',
    );
  });

  it.each<SessionState>(['QUESTION_ACTIVE', 'QUESTION_RESULTS', 'FINISHED'])(
    'no incorpora nuevos participantes en %s',
    (state) => {
      const session = service.createSession(gameWorkbook);
      if (state === 'FINISHED') {
        service.transitionSession(session.id, session.teacherToken, state);
      } else {
        service.transitionSession(
          session.id,
          session.teacherToken,
          'QUESTION_ACTIVE',
        );
        if (state === 'QUESTION_RESULTS')
          service.transitionSession(session.id, session.teacherToken, state);
      }
      expectDomainError(
        () => service.joinSession(session.joinCode, 'Ana', 'socket-1'),
        'SESSION_NOT_IN_LOBBY',
      );
    },
  );

  it('recupera el participante y su puntuación con ID y token durante una pregunta', () => {
    const session = service.createSession(gameWorkbook);
    const participant = service.joinSession(
      session.joinCode,
      'Ana',
      'socket-1',
    );
    // Fixture de puntos previos para aislar la prueba de reconexión.
    const stored = repository
      .getById(session.id)
      ?.participants.get(participant.id);
    if (!stored) throw new Error('Falta el participante de prueba.');
    stored.totalPoints = 750;
    expect(
      service.disconnectParticipant(session.id, participant.id, 'socket-1'),
    ).toBe(true);
    service.transitionSession(
      session.id,
      session.teacherToken,
      'QUESTION_ACTIVE',
    );
    now = 2000;
    const restored = service.reconnectParticipant(
      session.joinCode,
      participant.id,
      participant.reconnectToken,
      'socket-2',
    );
    expect(restored).toMatchObject({
      id: participant.id,
      nick: 'Ana',
      totalPoints: 750,
      socketId: 'socket-2',
      connected: true,
    });
    expect(service.getSession(session.id).participants.size).toBe(1);
    expect(service.getSession(session.id).lastActivityAt).toBe(2000);
  });

  it('rechaza tokens de reconexión incorrectos y no permite recuperar por nick', () => {
    const session = service.createSession(gameWorkbook);
    const first = service.joinSession(session.joinCode, 'Ana', 'socket-1');
    const second = service.joinSession(session.joinCode, 'Luis', 'socket-2');
    for (const token of ['', second.reconnectToken, session.teacherToken]) {
      expectDomainError(
        () =>
          service.reconnectParticipant(
            session.joinCode,
            first.id,
            token,
            'socket-3',
          ),
        'INVALID_RECONNECT_TOKEN',
      );
    }
    expectDomainError(
      () =>
        service.reconnectParticipant(
          session.joinCode,
          first.nick,
          first.reconnectToken,
          'socket-3',
        ),
      'PARTICIPANT_NOT_FOUND',
    );
    expect(
      service.getSession(session.id).participants.get(first.id)?.socketId,
    ).toBe('socket-1');
  });

  it('ignora una desconexión tardía del socket sustituido al reconectar', () => {
    const session = service.createSession(gameWorkbook);
    const participant = service.joinSession(
      session.joinCode,
      'Ana',
      'socket-1',
    );
    service.reconnectParticipant(
      session.joinCode,
      participant.id,
      participant.reconnectToken,
      'socket-2',
    );
    expect(
      service.disconnectParticipant(session.id, participant.id, 'socket-1'),
    ).toBe(false);
    expect(
      service.getSession(session.id).participants.get(participant.id),
    ).toMatchObject({ connected: true, socketId: 'socket-2' });
    expect(
      service.disconnectParticipant(session.id, participant.id, 'socket-2'),
    ).toBe(true);
    expect(
      service.getSession(session.id).participants.get(participant.id),
    ).toMatchObject({ connected: false, socketId: null });
  });

  it('rechaza una conexión vacía antes de modificar los participantes', () => {
    const session = service.createSession(gameWorkbook);
    expectDomainError(
      () => service.joinSession(session.joinCode, 'Ana', ' '),
      'INVALID_SOCKET_ID',
    );
    const participant = service.joinSession(
      session.joinCode,
      'Ana',
      'socket-1',
    );
    expectDomainError(
      () =>
        service.reconnectParticipant(
          session.joinCode,
          participant.id,
          participant.reconnectToken,
          '',
        ),
      'INVALID_SOCKET_ID',
    );
    expect(
      service.getSession(session.id).participants.get(participant.id)?.socketId,
    ).toBe('socket-1');
  });

  it('devuelve copias que no pueden alterar el estado interno', () => {
    const session = service.createSession(gameWorkbook);
    const participant = service.joinSession(
      session.joinCode,
      'Ana',
      'socket-1',
    );
    session.state = 'FINISHED';
    participant.totalPoints = 999;
    const snapshot = service.getSession(session.id);
    snapshot.participants.clear();
    expect(service.getSession(session.id).state).toBe('LOBBY');
    expect(
      service.getSession(session.id).participants.get(participant.id)
        ?.totalPoints,
    ).toBe(0);
  });

  it('devuelve errores de dominio para sesiones y participantes inexistentes', () => {
    expectDomainError(
      () => service.getSession('inexistente'),
      'SESSION_NOT_FOUND',
    );
    expectDomainError(
      () => service.joinSession('XXXXXX', 'Ana', 'socket-1'),
      'SESSION_NOT_FOUND',
    );
    const session = service.createSession(gameWorkbook);
    expectDomainError(
      () =>
        service.disconnectParticipant(session.id, 'inexistente', 'socket-1'),
      'PARTICIPANT_NOT_FOUND',
    );
  });

  it('limpia partidas terminadas por finishedAt y abandonadas por lastActivityAt, incluidos sus códigos', () => {
    const abandoned = service.createSession(gameWorkbook);
    const finished = service.createSession(gameWorkbook);
    const participant = service.joinSession(
      finished.joinCode,
      'Ana',
      'socket-1',
    );
    now = 1100;
    service.transitionSession(finished.id, finished.teacherToken, 'FINISHED');
    now = 1199;
    service.reconnectParticipant(
      finished.joinCode,
      participant.id,
      participant.reconnectToken,
      'socket-2',
    );
    const ttls = { sessionTtlMs: 1000, finishedSessionTtlMs: 100 };
    expect(service.cleanupExpired(ttls)).toBe(0);
    now = 1200;
    expect(service.cleanupExpired(ttls)).toBe(1);
    expect(repository.getByJoinCode(finished.joinCode)).toBeUndefined();
    expect(service.getSession(abandoned.id).state).toBe('LOBBY');
    now = 2000;
    expect(service.cleanupExpired(ttls)).toBe(1);
    expect(repository.size).toBe(0);
  });

  it('la actividad del participante renueva el TTL de una partida sin terminar', () => {
    const session = service.createSession(gameWorkbook);
    now = 1500;
    service.joinSession(session.joinCode, 'Ana', 'socket-1');
    now = 2000;
    expect(
      service.cleanupExpired({ sessionTtlMs: 1000, finishedSessionTtlMs: 100 }),
    ).toBe(0);
    now = 2500;
    expect(
      service.cleanupExpired({ sessionTtlMs: 1000, finishedSessionTtlMs: 100 }),
    ).toBe(1);
  });

  it('rechaza TTL inválidos sin eliminar partidas', () => {
    service.createSession(gameWorkbook);
    for (const invalid of [0, -1, 0.5, NaN, Infinity]) {
      expect(() =>
        service.cleanupExpired({
          sessionTtlMs: invalid,
          finishedSessionTtlMs: 100,
        }),
      ).toThrow(RangeError);
      expect(() =>
        service.cleanupExpired({
          sessionTtlMs: 100,
          finishedSessionTtlMs: invalid,
        }),
      ).toThrow(RangeError);
    }
    expect(repository.size).toBe(1);
  });
});
