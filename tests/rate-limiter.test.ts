import { describe, expect, it } from 'vitest';
import { LobbyRateLimiter } from '../src/realtime/rate-limiter.ts';

const limited = expect.objectContaining({ code: 'RATE_LIMITED' });

describe('Límites de abuso', () => {
  it('comparte intentos de creación entre reconexiones y libera el presupuesto al pasar un minuto', () => {
    let now = 1000;
    const limiter = new LobbyRateLimiter(() => now);
    for (let index = 0; index < 5; index += 1)
      limiter.check('aula', true, `socket-${index}`);
    expect(() => limiter.check('aula', true, 'socket-nuevo')).toThrow(limited);
    limiter.check('otra-red', true, 'otro');
    now += 60_000;
    limiter.check('aula', true, 'socket-nuevo');
  });

  it('admite 40 alumnos con tres reconexiones en una misma IP y limita un socket abusivo', () => {
    const limiter = new LobbyRateLimiter();
    for (let round = 0; round < 4; round += 1)
      for (let student = 0; student < 40; student += 1)
        limiter.check('aula', false, `${round}-${student}`);
    for (let count = 0; count < 120; count += 1)
      limiter.check('aula', false, 'abusivo');
    expect(() => limiter.check('aula', false, 'abusivo')).toThrow(limited);
    limiter.check('aula', false, 'otro-alumno');
  });

  it('limita intentos anónimos aunque se cambie de socket y aísla otras IP', () => {
    const limiter = new LobbyRateLimiter();
    for (let count = 0; count < 600; count += 1)
      limiter.check('red', false, `nuevo-${count}`);
    expect(() => limiter.check('red', false, 'nuevo')).toThrow(limited);
    limiter.check('otra-red', false, 'otro');
  });

  it('conserva el presupuesto de juego por participante y aísla alumnos y sesiones', () => {
    let now = 0;
    const limiter = new LobbyRateLimiter(() => now);
    for (let count = 0; count < 120; count += 1)
      limiter.checkGameplay('partida:alumno');
    expect(() => limiter.checkGameplay('partida:alumno')).toThrow(limited);
    limiter.checkGameplay('partida:otro');
    limiter.checkGameplay('otra-partida:alumno');
    now = 60_000;
    limiter.prune();
    limiter.checkGameplay('partida:alumno');
  });

  it('acota la memoria de contadores sin expulsar ventanas activas y la libera al caducar', () => {
    let now = 0;
    const limiter = new LobbyRateLimiter(() => now);
    for (let count = 0; count < 10_000; count += 1)
      limiter.checkGameplay(`identidad-${count}`);
    expect(() => limiter.checkGameplay('otra')).toThrow(limited);
    now = 60_000;
    limiter.prune();
    limiter.checkGameplay('otra');
  });
});
