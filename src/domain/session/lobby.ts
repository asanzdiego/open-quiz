import type { Session, SessionState } from './session.ts';

export interface LobbySnapshot {
  joinCode: string;
  state: SessionState;
  questionCount: number;
  participants: {
    id: string;
    nick: string;
    connected: boolean;
    totalPoints: number;
  }[];
}

/** Lista explícita de campos públicos: jamás serializar Session o Participant. */
export function getLobbySnapshot(session: Session): LobbySnapshot {
  return {
    joinCode: session.joinCode,
    state: session.state,
    questionCount: session.questions.length,
    participants: [...session.participants.values()].map((participant) => ({
      id: participant.id,
      nick: participant.nick,
      connected: participant.connected,
      totalPoints: participant.totalPoints,
    })),
  };
}
