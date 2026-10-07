import { LobbyRequestError } from './payloads.ts';

/** Presupuesto compartido por IP y por identidad; no confiar en X-Forwarded-For. */
export class LobbyRateLimiter {
  readonly #windows = new Map<string, { startedAt: number; count: number }>();
  readonly #now: () => number;
  #nextPruneAt = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  check(address: string, creatingSession: boolean, socketId = address): void {
    const now = this.#now();
    this.prune();
    // Una red de aula o un proxy puede compartir IP entre todos los alumnos.
    this.#consume(`operations:${address}`, 600, now);
    this.#consume(`socket:${socketId}`, 120, now);
    if (creatingSession) this.#consume(`create:${address}`, 5, now);
  }

  checkGameplay(identity: string): void {
    this.prune();
    this.#consume(`game:${identity}`, 120, this.#now());
  }

  prune(): void {
    const now = this.#now();
    if (now < this.#nextPruneAt) return;
    this.#nextPruneAt = now + 1000;
    for (const [key, window] of this.#windows)
      if (now - window.startedAt >= 60_000) this.#windows.delete(key);
  }

  #consume(key: string, limit: number, now: number): void {
    let window = this.#windows.get(key);
    if (window && now - window.startedAt >= 60_000) {
      window.startedAt = now;
      window.count = 0;
    }
    if (!window) {
      if (this.#windows.size >= 10_000) this.#limited();
      window = { startedAt: now, count: 0 };
      this.#windows.set(key, window);
    }
    if (window.count >= limit) this.#limited();
    window.count += 1;
  }

  #limited(): never {
    throw new LobbyRequestError(
      'RATE_LIMITED',
      'Has realizado demasiados intentos. Espera un minuto y vuelve a intentarlo.',
    );
  }
}
