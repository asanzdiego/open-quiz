import type { Server, Socket } from 'socket.io';
import type { LobbySnapshot } from '../domain/session/lobby.ts';

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

export interface ClientToServerEvents {
  'teacher:create-session': (payload: CreateSessionPayload) => void;
  'teacher:reconnect': (payload: TeacherReconnectPayload) => void;
  'student:join': (payload: StudentJoinPayload) => void;
  'student:reconnect': (payload: StudentReconnectPayload) => void;
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
