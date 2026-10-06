import type {
  AnswerOption,
  ParticipantResult,
  RoundResult,
  ResultPersistence,
} from '../question/round.ts';
import type { Session, SessionState } from './session.ts';

export interface PublicQuestion {
  questionId: string;
  questionNumber: number;
  questionCount: number;
  text: string;
  options: AnswerOption[];
  startedAt: number;
  endsAt: number;
  durationMs: number;
}
export interface RankingEntry {
  participantId: string;
  nick: string;
  totalPoints: number;
  position: number;
}
export interface QuestionProgress {
  questionId: string;
  answeredCount: number;
  participantCount: number;
}
export interface PublicQuestionResult {
  questionId: string;
  questionNumber: number;
  correctOptionId: string;
  correctAnswer: string;
  answeredCount: number;
  correctCount: number;
  participantCount: number;
  hasNextQuestion: boolean;
}
export interface StudentResult extends ParticipantResult {
  position: number;
}
export interface GameEnded {
  ranking: RankingEntry[];
  podium: RankingEntry[];
}
export interface GameSnapshot {
  state: SessionState;
  question: PublicQuestion | null;
  result: PublicQuestionResult | null;
  ranking: RankingEntry[];
  podium: RankingEntry[];
  progress: QuestionProgress | null;
  self: {
    participantId: string;
    hasAnswered: boolean;
    answerOptionId: string | null;
    result: StudentResult | null;
  } | null;
  serverNow: number;
  workbookSave: WorkbookSaveSnapshot | null;
}

export interface WorkbookSaveSnapshot extends ResultPersistence {
  questionNumber: number;
  worksheetName: string;
}

export function getWorkbookSave(session: Session): WorkbookSaveSnapshot | null {
  const result = session.completedRounds.at(-1);
  return result
    ? {
        questionNumber: result.questionNumber,
        worksheetName: `P${String(result.questionNumber).padStart(2, '0')}`,
        ...structuredClone(result.persistence),
      }
    : null;
}

/** Los empates conservan el orden de incorporación de Map, mediante sort estable. */
export function getRanking(session: Session): RankingEntry[] {
  return [...session.participants.values()]
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((participant, index) => ({
      participantId: participant.id,
      nick: participant.nick,
      totalPoints: participant.totalPoints,
      position: index + 1,
    }));
}

export function getPublicQuestion(session: Session): PublicQuestion | null {
  const round = session.currentRound;
  if (!round) return null;
  return {
    questionId: round.questionId,
    questionNumber: round.questionNumber,
    questionCount: session.questions.length,
    text: round.text,
    options: round.options.map((option) => ({ ...option })),
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    durationMs: round.durationMs,
  };
}

export function getQuestionProgress(session: Session): QuestionProgress | null {
  const round = session.currentRound;
  return round
    ? {
        questionId: round.questionId,
        answeredCount: round.answers.size,
        participantCount: round.participantIds.length,
      }
    : null;
}

function latestResult(session: Session): RoundResult | undefined {
  // Nunca mostrar los resultados anteriores como resultado de la pregunta activa.
  return session.state === 'QUESTION_RESULTS' || session.state === 'FINISHED'
    ? session.completedRounds.at(-1)
    : undefined;
}

export function getPublicResult(session: Session): PublicQuestionResult | null {
  const result = latestResult(session);
  if (!result) return null;
  return {
    questionId: result.questionId,
    questionNumber: result.questionNumber,
    correctOptionId: result.correctOptionId,
    correctAnswer: result.correctAnswer,
    answeredCount: result.participants.filter((entry) => entry.answered).length,
    correctCount: result.participants.filter((entry) => entry.isCorrect).length,
    participantCount: result.participants.length,
    hasNextQuestion:
      session.currentQuestionIndex + 1 < session.questions.length,
  };
}

export function getStudentResult(
  session: Session,
  participantId: string,
  ranking = getRanking(session),
): StudentResult | null {
  const result = latestResult(session)?.participants.find(
    (entry) => entry.participantId === participantId,
  );
  const position = ranking.find(
    (entry) => entry.participantId === participantId,
  )?.position;
  return result && position ? { ...result, position } : null;
}

export function getStudentResults(
  session: Session,
  ranking = getRanking(session),
): StudentResult[] {
  const positions = new Map(
    ranking.map((entry) => [entry.participantId, entry.position]),
  );
  return (latestResult(session)?.participants ?? []).map((entry) => ({
    ...entry,
    position: positions.get(entry.participantId)!,
  }));
}

/** Construcción explícita de campos públicos, sin serializar los modelos internos. */
export function getGameSnapshot(
  session: Session,
  serverNow: number,
  participantId?: string,
): GameSnapshot {
  const ranking = getRanking(session);
  return {
    state: session.state,
    question: getPublicQuestion(session),
    result: getPublicResult(session),
    ranking,
    podium: session.state === 'FINISHED' ? ranking.slice(0, 3) : [],
    progress: participantId ? null : getQuestionProgress(session),
    self: participantId
      ? {
          participantId,
          hasAnswered:
            session.currentRound?.answers.has(participantId) ?? false,
          answerOptionId:
            session.currentRound?.answers.get(participantId)?.answerOptionId ??
            null,
          result: getStudentResult(session, participantId, ranking),
        }
      : null,
    serverNow,
    workbookSave: participantId ? null : getWorkbookSave(session),
  };
}
