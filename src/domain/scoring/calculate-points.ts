export const DEFAULT_MAX_POINTS_PER_QUESTION = 1000;

export interface ScoringInput {
  isCorrect: boolean;
  elapsedMs: number;
  durationMs: number;
  maxPoints?: number;
}

export function calculatePoints({
  isCorrect,
  elapsedMs,
  durationMs,
  maxPoints = DEFAULT_MAX_POINTS_PER_QUESTION,
}: ScoringInput): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(
      'La duración debe ser un número positivo de milisegundos.',
    );
  }
  if (!Number.isFinite(elapsedMs)) {
    throw new RangeError('El tiempo empleado debe ser un número finito.');
  }
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 0) {
    throw new RangeError(
      'Los puntos máximos deben ser un entero no negativo seguro.',
    );
  }

  if (!isCorrect) return 0;

  const remainingFraction = Math.max(
    0,
    1 - Math.max(0, elapsedMs) / durationMs,
  );
  return Math.min(
    maxPoints,
    Math.max(0, Math.round(maxPoints * remainingFraction)),
  );
}
