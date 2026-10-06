export type DomainErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_COLLISION'
  | 'JOIN_CODE_UNAVAILABLE'
  | 'INVALID_TRANSITION'
  | 'INVALID_TEACHER_TOKEN'
  | 'SESSION_NOT_IN_LOBBY'
  | 'INVALID_NICK'
  | 'NICK_TAKEN'
  | 'PARTICIPANT_NOT_FOUND'
  | 'INVALID_RECONNECT_TOKEN'
  | 'INVALID_SOCKET_ID'
  | 'NO_QUESTIONS'
  | 'NO_MORE_QUESTIONS'
  | 'QUESTION_NOT_ACTIVE'
  | 'QUESTION_MISMATCH'
  | 'QUESTION_EXPIRED'
  | 'INVALID_ANSWER_OPTION'
  | 'PARTICIPANT_NOT_CONNECTED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
