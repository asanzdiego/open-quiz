import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '../domain/identifiers.ts';
import { normalizeNick } from '../domain/participant/participant.ts';
import { normalizeWorkbookReference } from '../services/workbook-reference.ts';
import type {
  CreateSessionPayload,
  TeacherReconnectPayload,
  StudentJoinPayload,
  StudentReconnectPayload,
  StudentAnswerPayload,
} from './events.ts';

export class LobbyRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function parseStudentAnswer(payload: unknown): StudentAnswerPayload {
  const input = object(payload, ['questionId', 'answerOptionId']);
  return {
    questionId: uuid(input.questionId),
    answerOptionId: uuid(input.answerOptionId),
  };
}

function object(payload: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(payload, key))
  )
    invalid();
  return payload as Record<string, unknown>;
}
function invalid(): never {
  throw new LobbyRequestError(
    'INVALID_PAYLOAD',
    'Los datos enviados no tienen el formato esperado.',
  );
}
function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}
function uuid(value: unknown): string {
  const result = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      result,
    )
  )
    invalid();
  return result;
}
function token(value: unknown): string {
  const result = string(value);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(result)) invalid();
  return result;
}
function code(value: unknown): string {
  const result = string(value).trim().toUpperCase();
  if (
    result.length !== JOIN_CODE_LENGTH ||
    [...result].some((character) => !JOIN_CODE_ALPHABET.includes(character))
  ) {
    throw new LobbyRequestError(
      'INVALID_JOIN_CODE',
      'El código de partida debe tener seis letras o números válidos.',
    );
  }
  return result;
}
export function parseCreateSession(payload: unknown): CreateSessionPayload {
  const input = object(payload, ['workbookReference']);
  return {
    workbookReference: normalizeWorkbookReference(
      string(input.workbookReference),
    ),
  };
}
export function parseTeacherReconnect(
  payload: unknown,
): TeacherReconnectPayload {
  const input = object(payload, ['sessionId', 'teacherToken']);
  return {
    sessionId: uuid(input.sessionId),
    teacherToken: token(input.teacherToken),
  };
}
export function parseStudentJoin(payload: unknown): StudentJoinPayload {
  const input = object(payload, ['joinCode', 'nick']);
  return {
    joinCode: code(input.joinCode),
    nick: normalizeNick(string(input.nick)),
  };
}
export function parseStudentReconnect(
  payload: unknown,
): StudentReconnectPayload {
  const input = object(payload, [
    'joinCode',
    'participantId',
    'reconnectToken',
  ]);
  return {
    joinCode: code(input.joinCode),
    participantId: uuid(input.participantId),
    reconnectToken: token(input.reconnectToken),
  };
}
