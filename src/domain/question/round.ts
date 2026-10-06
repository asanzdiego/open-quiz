import { randomInt, randomUUID } from 'node:crypto';
import type { Question } from './question.ts';

export interface AnswerOption {
  id: string;
  text: string;
}

export interface QuestionRound {
  questionId: string;
  questionNumber: number;
  text: string;
  options: AnswerOption[];
  correctOptionId: string;
  startedAt: number;
  durationMs: number;
  endsAt: number;
  participantIds: string[];
  answers: Map<string, { answerOptionId: string; elapsedMs: number }>;
}

export interface ParticipantResult {
  participantId: string;
  nick: string;
  answered: boolean;
  isCorrect: boolean;
  elapsedMs: number;
  points: number;
  totalPoints: number;
}

export interface ResultPersistence {
  status: 'pending' | 'saving' | 'saved' | 'error';
  error: { code: string; message: string } | null;
}

/** Resultado y estado de guardado conservados en memoria hasta que expire la sesión. */
export interface RoundResult {
  questionId: string;
  questionNumber: number;
  correctOptionId: string;
  correctAnswer: string;
  participants: ParticipantResult[];
  persistence: ResultPersistence;
}

export function createQuestionRound(
  question: Question,
  questionNumber: number,
  participantIds: string[],
  startedAt: number,
  durationMs: number,
): QuestionRound {
  // Los UUID no codifican la posición ni si la respuesta es correcta.
  const options = [question.correctAnswer, ...question.incorrectAnswers].map(
    (text) => ({ id: randomUUID(), text }),
  );
  const correctOptionId = options[0]!.id;
  for (let index = options.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [options[index], options[target]] = [options[target]!, options[index]!];
  }
  return {
    questionId: question.id,
    questionNumber,
    text: question.text,
    options,
    correctOptionId,
    startedAt,
    durationMs,
    endsAt: startedAt + durationMs,
    participantIds,
    answers: new Map(),
  };
}
