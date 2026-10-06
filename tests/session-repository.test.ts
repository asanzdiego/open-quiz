import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/domain/errors.ts';
import { InMemorySessionRepository } from '../src/domain/session/in-memory-session-repository.ts';
import type { Session } from '../src/domain/session/session.ts';

function sessionFixture(id: string, joinCode: string): Session {
  return {
    id,
    joinCode,
    teacherToken: 'token-de-prueba',
    state: 'LOBBY',
    workbookReference: null,
    questions: [],
    currentQuestionIndex: -1,
    currentRound: null,
    completedRounds: [],
    participants: new Map(),
    createdAt: 1000,
    lastActivityAt: 1000,
    finishedAt: null,
  };
}

describe('Repositorio de sesiones en memoria', () => {
  it('permite buscar por ID y por código sin distinguir mayúsculas o espacios exteriores', () => {
    const repository = new InMemorySessionRepository();
    const session = sessionFixture('session-1', 'ABC234');
    repository.add(session);

    expect(repository.size).toBe(1);
    expect(repository.getById(session.id)).toBe(session);
    expect(repository.getByJoinCode(' abc234 ')).toBe(session);
    expect([...repository.values()]).toEqual([session]);
    expect(repository.getById('inexistente')).toBeUndefined();
    expect(repository.getByJoinCode('XXXXXX')).toBeUndefined();
  });

  it('rechaza IDs o códigos duplicados sin sobrescribir una sesión', () => {
    const repository = new InMemorySessionRepository();
    const original = sessionFixture('session-1', 'ABC234');
    repository.add(original);

    expect(() => repository.add(sessionFixture('session-1', 'DEF567'))).toThrow(
      DomainError,
    );
    expect(() => repository.add(sessionFixture('session-2', 'ABC234'))).toThrow(
      DomainError,
    );
    expect(repository.size).toBe(1);
    expect(repository.getById('session-1')).toBe(original);
    expect(repository.getByJoinCode('DEF567')).toBeUndefined();
  });

  it('elimina también el índice de código y permite reutilizarlo', () => {
    const repository = new InMemorySessionRepository();
    repository.add(sessionFixture('session-1', 'ABC234'));
    expect(repository.delete('session-1')).toBe(true);
    expect(repository.delete('session-1')).toBe(false);
    expect(repository.getByJoinCode('ABC234')).toBeUndefined();

    repository.add(sessionFixture('session-2', 'ABC234'));
    expect(repository.getByJoinCode('ABC234')?.id).toBe('session-2');
  });

  it('mantiene aisladas las distintas instancias', () => {
    const first = new InMemorySessionRepository();
    const second = new InMemorySessionRepository();
    first.add(sessionFixture('session-1', 'ABC234'));
    expect(second.size).toBe(0);
    expect(second.getByJoinCode('ABC234')).toBeUndefined();
  });
});
