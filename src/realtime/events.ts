import type { Server, Socket } from 'socket.io';
import type { LobbySnapshot } from '../domain/session/lobby.ts';
import type {
  GameEnded,
  GameSnapshot,
  PublicQuestion,
  PublicQuestionResult,
  QuestionProgress,
  RankingEntry,
  StudentResult,
} from '../domain/session/game.ts';

export interface CreateSessionPayload {
  workbookReference: string;
}
export interface TeacherReconnectPayload {
  sessionId: string;
  teacherToken: string;
}
export interface StudentJoinPayload {
  joinCode: string;
  nick: string;
}
export interface StudentReconnectPayload {
  joinCode: string;
  participantId: string;
  reconnectToken: string;
}
export type TeacherControlPayload = TeacherReconnectPayload;
export interface StudentAnswerPayload {
  questionId: string;
  answerOptionId: string;
}

export interface ClientToServerEvents {
  'teacher:create-session': (payload: CreateSessionPayload) => void;
  'teacher:reconnect': (payload: TeacherReconnectPayload) => void;
  'student:join': (payload: StudentJoinPayload) => void;
  'student:reconnect': (payload: StudentReconnectPayload) => void;
  'teacher:start-game': (payload: TeacherControlPayload) => void;
  'teacher:start-next-question': (payload: TeacherControlPayload) => void;
  'teacher:close-question': (payload: TeacherControlPayload) => void;
  'teacher:end-game': (payload: TeacherControlPayload) => void;
  'student:answer': (payload: StudentAnswerPayload) => void;
}
export type LobbyOperation = keyof ClientToServerEvents;

export interface TeacherSession {
  sessionId: string;
  joinCode: string;
  teacherToken: string;
  lobby: LobbySnapshot;
}
export interface StudentSession {
  joinCode: string;
  participantId: string;
  reconnectToken: string;
  nick: string;
  totalPoints: number;
  lobby: LobbySnapshot;
}
export interface AppError {
  operation: LobbyOperation;
  code: string;
  message: string;
}
export interface ServerToClientEvents {
  'session:created': (payload: TeacherSession) => void;
  'session:restored': (payload: TeacherSession) => void;
  'student:joined': (payload: StudentSession) => void;
  'student:restored': (payload: StudentSession) => void;
  'lobby:updated': (payload: LobbySnapshot) => void;
  'game:updated': (payload: GameSnapshot) => void;
  'question:started': (payload: PublicQuestion) => void;
  'question:progress': (payload: QuestionProgress) => void;
  'answer:accepted': (payload: {
    questionId: string;
    answerOptionId: string;
  }) => void;
  'question:ended': (payload: PublicQuestionResult) => void;
  'student:result': (payload: StudentResult) => void;
  'ranking:updated': (payload: RankingEntry[]) => void;
  'game:ended': (payload: GameEnded) => void;
  'app:error': (payload: AppError) => void;
}
export type Membership =
  | { role: 'teacher'; sessionId: string }
  | { role: 'student'; sessionId: string; participantId: string };
export interface SocketData {
  membership?: Membership;
  busy?: boolean;
}
export type LobbyServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type LobbySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
