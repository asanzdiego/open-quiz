import { randomUUID } from 'node:crypto';
import type { SessionWorkbook } from '../../src/domain/session/session.ts';

export const gameWorkbook: SessionWorkbook = {
  reference: 'Quiz/prueba.xlsx',
  questions: [
    {
      id: randomUUID(),
      text: '¿Cuánto es 2 + 2?',
      correctAnswer: '4',
      incorrectAnswers: ['3', '5', '6'],
    },
    {
      id: randomUUID(),
      text: '¿Cuál es el planeta rojo?',
      correctAnswer: 'Marte',
      incorrectAnswers: ['Venus', 'Tierra', 'Júpiter'],
    },
  ],
};
