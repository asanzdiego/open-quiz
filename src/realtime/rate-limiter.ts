import { LobbyRequestError } from './payloads.ts';

/** Límites por IP compartidos entre sockets; una reconexión no reinicia el contador. */
export class LobbyRateLimiter {
  readonly #windows = new Map<string, { startedAt: number; count: number }>();

  check(address: string, creatingSession: boolean): void {
    const now = Date.now();
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= 60_000) this.#windows.delete(key);
    }
    this.#consume(`operations:${address}`, 120, now);
    if (creatingSession) this.#consume(`create:${address}`, 5, now);
  }

  checkGameplay(socketId: string): void {
    const now = Date.now();
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= 60_000) this.#windows.delete(key);
    }
    this.#consume(`game:${socketId}`, 120, now);
  }

  #consume(key: string, limit: number, now: number): void {
    const window = this.#windows.get(key) ?? { startedAt: now, count: 0 };
    this.#windows.set(key, window);
    if (window.count >= limit) {
      throw new LobbyRequestError(
        'RATE_LIMITED',
        'Has realizado demasiados intentos. Espera un minuto y vuelve a intentarlo.',
      );
    }
    window.count += 1;
  }
}
