import { describe, expect, it } from 'vitest';
import { calculatePoints } from '../src/domain/scoring/calculate-points.ts';

describe('Puntuación lineal', () => {
  it.each([0, 5000, 10000, 20000, 30000])(
    'una respuesta incorrecta recibe cero puntos tras %i ms',
    (elapsedMs) => {
      expect(
        calculatePoints({ isCorrect: false, elapsedMs, durationMs: 20000 }),
      ).toBe(0);
    },
  );

  it.each([
    [-1000, 1000],
    [0, 1000],
    [5000, 750],
    [10000, 500],
    [15000, 250],
    [20000, 0],
    [30000, 0],
  ])(
    'una respuesta correcta tras %i ms recibe %i puntos',
    (elapsedMs, expected) => {
      expect(
        calculatePoints({ isCorrect: true, elapsedMs, durationMs: 20000 }),
      ).toBe(expected);
    },
  );

  it('redondea a un entero y permite configurar los puntos máximos', () => {
    expect(
      calculatePoints({
        isCorrect: true,
        elapsedMs: 1000,
        durationMs: 3000,
        maxPoints: 2000,
      }),
    ).toBe(1333);
    expect(
      calculatePoints({
        isCorrect: true,
        elapsedMs: 0,
        durationMs: 20000,
        maxPoints: 0,
      }),
    ).toBe(0);
  });

  it('mantiene los puntos dentro del intervalo para tiempos extremos', () => {
    for (const elapsedMs of [
      -Number.MAX_VALUE,
      -1,
      0,
      1,
      12345,
      20000,
      Number.MAX_VALUE,
    ]) {
      const points = calculatePoints({
        isCorrect: true,
        elapsedMs,
        durationMs: 20000,
        maxPoints: 1500,
      });
      expect(Number.isInteger(points)).toBe(true);
      expect(points).toBeGreaterThanOrEqual(0);
      expect(points).toBeLessThanOrEqual(1500);
    }
  });

  it.each([0, -1, NaN, Infinity])(
    'rechaza una duración inválida: %s',
    (durationMs) => {
      expect(() =>
        calculatePoints({ isCorrect: true, elapsedMs: 0, durationMs }),
      ).toThrow(RangeError);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    'rechaza un tiempo empleado no finito: %s',
    (elapsedMs) => {
      expect(() =>
        calculatePoints({ isCorrect: true, elapsedMs, durationMs: 20000 }),
      ).toThrow(RangeError);
    },
  );

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rechaza un máximo inválido: %s',
    (maxPoints) => {
      expect(() =>
        calculatePoints({
          isCorrect: true,
          elapsedMs: 0,
          durationMs: 20000,
          maxPoints,
        }),
      ).toThrow(RangeError);
    },
  );
});
