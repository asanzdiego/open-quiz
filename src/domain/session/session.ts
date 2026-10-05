import { DomainError } from '../errors.ts';
import type { Participant } from '../participant/participant.ts';

export type SessionState =
  'LOBBY' | 'QUESTION_ACTIVE' | 'QUESTION_RESULTS' | 'FINISHED';

// Modelo exclusivo del backend: contiene secretos y no debe emitirse a clientes.
export interface Session {
  readonly id: string;
  readonly joinCode: string;
  readonly teacherToken: string;
  readonly createdAt: number;
  state: SessionState;
  lastActivityAt: number;
  finishedAt: number | null;
  readonly participants: Map<string, Participant>;
}

const transitions: Record<SessionState, readonly SessionState[]> = {
  LOBBY: ['QUESTION_ACTIVE', 'FINISHED'],
  QUESTION_ACTIVE: ['QUESTION_RESULTS'],
  QUESTION_RESULTS: ['QUESTION_ACTIVE', 'FINISHED'],
  FINISHED: [],
};

export function assertSessionTransition(
  current: SessionState,
  next: SessionState,
): void {
  if (!transitions[current].includes(next)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      'No se puede realizar esa operación en el estado actual de la partida.',
    );
  }
}
