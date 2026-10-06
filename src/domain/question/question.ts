// Modelo exclusivo del backend: la respuesta correcta no se emite durante una pregunta activa.
export interface Question {
  readonly id: string;
  readonly text: string;
  readonly correctAnswer: string;
  readonly incorrectAnswers: readonly [string, string, string];
}
