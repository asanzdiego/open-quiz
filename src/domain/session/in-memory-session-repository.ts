import { DomainError } from '../errors.ts';
import type { Session } from './session.ts';

export class InMemorySessionRepository {
  readonly #sessions = new Map<string, Session>();
  readonly #sessionIdsByCode = new Map<string, string>();

  get size(): number {
    return this.#sessions.size;
  }

  // Las referencias mutables son internas; SessionService devuelve copias.
  getById(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  getByJoinCode(joinCode: string): Session | undefined {
    const id = this.#sessionIdsByCode.get(joinCode.trim().toUpperCase());
    return id === undefined ? undefined : this.#sessions.get(id);
  }

  add(session: Session): void {
    if (
      this.#sessions.has(session.id) ||
      this.#sessionIdsByCode.has(session.joinCode)
    ) {
      throw new DomainError(
        'SESSION_COLLISION',
        'Ya existe una partida con ese identificador o código.',
      );
    }

    this.#sessions.set(session.id, session);
    this.#sessionIdsByCode.set(session.joinCode, session.id);
  }

  delete(id: string): boolean {
    const session = this.#sessions.get(id);
    if (!session) return false;

    this.#sessionIdsByCode.delete(session.joinCode);
    return this.#sessions.delete(id);
  }

  values(): IterableIterator<Session> {
    return this.#sessions.values();
  }
}
