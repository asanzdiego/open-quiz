import { beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../src/services/session-service.ts';
import { gameWorkbook } from './helpers/game-fixture.ts';

describe('Fase 6: dominio del juego', () => {
  let now: number;
  let service: SessionService;
  beforeEach(() => {
    now = 1000;
    service = new SessionService(undefined, { now: () => now });
  });
  function setup() {
    const session = service.createSession(gameWorkbook);
    const ana = service.joinSession(session.joinCode, 'Ana', 'ana-socket');
    const luis = service.joinSession(session.joinCode, 'Luis', 'luis-socket');
    const maria = service.joinSession(
      session.joinCode,
      'María',
      'maria-socket',
    );
    return { session, ana, luis, maria };
  }
  function answer(
    id: string,
    participantId: string,
    socketId: string,
    correct = true,
  ) {
    const round = service.getSession(id).currentRound!;
    const option = round.options.find(
      (option) => (option.id === round.correctOptionId) === correct,
    )!;
    return service.submitAnswer(
      id,
      participantId,
      socketId,
      round.questionId,
      option.id,
    );
  }
  function markSaved(sessionId: string) {
    const result = service.getSession(sessionId).completedRounds.at(-1)!;
    service.setResultPersistence(sessionId, result.questionId, {
      status: 'saved',
      error: null,
    });
  }

  it('mantiene el orden de preguntas y una sola mezcla de opciones, sin datos de corrección activos', () => {
    const { session, ana } = setup();
    service.startGame(session.id, session.teacherToken);
    const first = service.getGameSnapshot(session.id);
    const student = service.getGameSnapshot(session.id, ana.id);
    expect(first.question).toMatchObject({
      questionId: gameWorkbook.questions[0]!.id,
      questionNumber: 1,
      startedAt: 1000,
      endsAt: 21000,
    });
    expect(first.question?.options).toEqual(student.question?.options);
    expect(first.question?.options.map((option) => option.text).sort()).toEqual(
      ['3', '4', '5', '6'],
    );
    expect(
      new Set(first.question?.options.map((option) => option.id)).size,
    ).toBe(4);
    expect(JSON.stringify(student)).not.toMatch(
      /correctOptionId|correctAnswer|isCorrect|teacherToken|reconnectToken|workbookReference|elapsedMs/,
    );
    service.closeQuestion(session.id, session.teacherToken);
    markSaved(session.id);
    const second = service.startNextQuestion(session.id, session.teacherToken);
    expect(second.currentRound?.questionId).toBe(gameWorkbook.questions[1]!.id);
    expect(service.getGameSnapshot(session.id, ana.id).result).toBeNull();
    first.question!.options.length = 0;
    expect(service.getGameSnapshot(session.id).question?.options).toHaveLength(
      4,
    );
  });

  it('rechaza respuestas antes de iniciar, opciones inexistentes, otras preguntas y después del cierre', () => {
    const { session, ana } = setup();
    const send = (questionId: string, answerOptionId: string) =>
      service.submitAnswer(
        session.id,
        ana.id,
        'ana-socket',
        questionId,
        answerOptionId,
      );
    expect(() => send('otra', 'opción')).toThrow(
      expect.objectContaining({ code: 'QUESTION_NOT_ACTIVE' }),
    );
    service.startGame(session.id, session.teacherToken);
    const round = service.getSession(session.id).currentRound!;
    expect(() => send('otra', round.correctOptionId)).toThrow(
      expect.objectContaining({ code: 'QUESTION_MISMATCH' }),
    );
    expect(() => send(round.questionId, 'inexistente')).toThrow(
      expect.objectContaining({ code: 'INVALID_ANSWER_OPTION' }),
    );
    expect(service.getSession(session.id).currentRound?.answers.size).toBe(0);
    service.closeQuestion(session.id, session.teacherToken);
    expect(() => send(round.questionId, round.correctOptionId)).toThrow(
      expect.objectContaining({ code: 'QUESTION_NOT_ACTIVE' }),
    );
  });

  it('acepta solo la primera respuesta válida y usa el tiempo del servidor', () => {
    const { session, ana } = setup();
    service.startGame(session.id, session.teacherToken);
    now += 5000;
    expect(answer(session.id, ana.id, 'ana-socket', false).accepted).toBe(true);
    now += 2000;
    expect(answer(session.id, ana.id, 'ana-socket').accepted).toBe(false);
    expect(
      service.getSession(session.id).currentRound?.answers.get(ana.id)
        ?.elapsedMs,
    ).toBe(5000);
    const closed = service.closeQuestion(session.id, session.teacherToken);
    expect(closed.completedRounds[0]?.participants[0]).toMatchObject({
      answered: true,
      isCorrect: false,
      points: 0,
    });
  });

  it('puntúa al cerrar una sola vez, incluye desconectados y no respuestas, y estabiliza empates por incorporación', () => {
    const { session, ana, luis, maria } = setup();
    service.startGame(session.id, session.teacherToken);
    now += 5000;
    answer(session.id, ana.id, 'ana-socket');
    answer(session.id, luis.id, 'luis-socket');
    service.disconnectParticipant(session.id, maria.id, 'maria-socket');
    expect(
      service.getSession(session.id).participants.get(ana.id)?.totalPoints,
    ).toBe(0);
    const closed = service.closeQuestion(session.id, session.teacherToken);
    expect(closed.completedRounds[0]?.participants).toHaveLength(3);
    expect(closed.completedRounds[0]?.participants[2]).toMatchObject({
      participantId: maria.id,
      answered: false,
      isCorrect: false,
      elapsedMs: 20000,
      points: 0,
      totalPoints: 0,
    });
    expect(
      service
        .getGameSnapshot(session.id)
        .ranking.map((entry) => [entry.nick, entry.totalPoints]),
    ).toEqual([
      ['Ana', 750],
      ['Luis', 750],
      ['María', 0],
    ]);
    expect(() =>
      service.closeQuestion(session.id, session.teacherToken),
    ).toThrow();
    expect(service.getSession(session.id).completedRounds).toHaveLength(1);
    markSaved(session.id);
    service.startNextQuestion(session.id, session.teacherToken);
    expect(() => answer(session.id, maria.id, 'maria-socket')).toThrow(
      expect.objectContaining({ code: 'PARTICIPANT_NOT_CONNECTED' }),
    );
  });

  it('rechaza exactamente el límite de tiempo aunque el temporizador aún no haya cerrado', () => {
    const { session, ana } = setup();
    service.startGame(session.id, session.teacherToken);
    now = 20999;
    expect(service.closeExpiredQuestion(session.id)).toBeNull();
    now = 21000;
    expect(() => answer(session.id, ana.id, 'ana-socket')).toThrow(
      expect.objectContaining({ code: 'QUESTION_EXPIRED' }),
    );
    expect(service.closeExpiredQuestion(session.id)?.state).toBe(
      'QUESTION_RESULTS',
    );
    expect(service.closeExpiredQuestion(session.id)).toBeNull();
    expect(service.getSession(session.id).currentQuestionIndex).toBe(0);
    expect(
      service
        .getSession(session.id)
        .completedRounds[0]?.participants.every((entry) => entry.points === 0),
    ).toBe(true);
  });

  it('acumula puntos, termina con podio y conserva resultados al reconectar', () => {
    const { session, ana, maria } = setup();
    service.startGame(session.id, session.teacherToken);
    now += 10000;
    answer(session.id, ana.id, 'ana-socket');
    service.closeQuestion(session.id, session.teacherToken);
    markSaved(session.id);
    service.startNextQuestion(session.id, session.teacherToken);
    answer(session.id, ana.id, 'ana-socket');
    service.closeQuestion(session.id, session.teacherToken);
    markSaved(session.id);
    expect(() =>
      service.startNextQuestion(session.id, session.teacherToken),
    ).toThrow(expect.objectContaining({ code: 'NO_MORE_QUESTIONS' }));
    service.endGame(session.id, session.teacherToken);
    service.reconnectParticipant(
      session.joinCode,
      ana.id,
      ana.reconnectToken,
      'ana-new',
    );
    const final = service.getGameSnapshot(session.id, ana.id);
    expect(final.podium).toHaveLength(3);
    expect(final.ranking[0]).toMatchObject({
      participantId: ana.id,
      totalPoints: 1500,
      position: 1,
    });
    expect(final.self?.result).toMatchObject({
      points: 1000,
      totalPoints: 1500,
      position: 1,
    });
    expect(
      service.getGameSnapshot(session.id, maria.id).self?.result,
    ).toMatchObject({ answered: false, totalPoints: 0, position: 3 });
    expect(() => service.startGame(session.id, session.teacherToken)).toThrow();
  });

  it('mantiene la respuesta en una reconexión y rechaza el socket sustituido', () => {
    const { session, ana } = setup();
    service.startGame(session.id, session.teacherToken);
    now += 5000;
    answer(session.id, ana.id, 'ana-socket');
    service.reconnectParticipant(
      session.joinCode,
      ana.id,
      ana.reconnectToken,
      'ana-new',
    );
    expect(service.getGameSnapshot(session.id, ana.id).self?.hasAnswered).toBe(
      true,
    );
    expect(() => answer(session.id, ana.id, 'ana-socket')).toThrow(
      expect.objectContaining({ code: 'PARTICIPANT_NOT_CONNECTED' }),
    );
    expect(answer(session.id, ana.id, 'ana-new').accepted).toBe(false);
    service.closeQuestion(session.id, session.teacherToken);
    expect(
      service.getGameSnapshot(session.id, ana.id).self?.result,
    ).toMatchObject({ points: 750 });
  });

  it('rechaza tokens de otras partidas y mantiene aislados rondas, respuestas y rankings', () => {
    const first = setup();
    const second = setup();
    expect(() =>
      service.startGame(first.session.id, second.session.teacherToken),
    ).toThrow(expect.objectContaining({ code: 'INVALID_TEACHER_TOKEN' }));
    service.startGame(first.session.id, first.session.teacherToken);
    service.startGame(second.session.id, second.session.teacherToken);
    answer(first.session.id, first.ana.id, 'ana-socket');
    service.closeQuestion(first.session.id, first.session.teacherToken);
    expect(service.getGameSnapshot(second.session.id)).toMatchObject({
      state: 'QUESTION_ACTIVE',
      progress: { answeredCount: 0 },
    });
    expect(
      service
        .getGameSnapshot(second.session.id)
        .ranking.every((entry) => entry.totalPoints === 0),
    ).toBe(true);
    expect(() =>
      service.submitAnswer(
        second.session.id,
        first.ana.id,
        'ana-socket',
        gameWorkbook.questions[0]!.id,
        'opción',
      ),
    ).toThrow(expect.objectContaining({ code: 'PARTICIPANT_NOT_FOUND' }));
  });

  it('valida la configuración y rechaza una partida sin preguntas', () => {
    const session = service.createSession();
    expect(() => service.startGame(session.id, session.teacherToken)).toThrow(
      expect.objectContaining({ code: 'NO_QUESTIONS' }),
    );
    for (const value of [NaN, Infinity, -1, 0.5, 3_600_001])
      expect(
        () => new SessionService(undefined, { questionDurationMs: value }),
      ).toThrow(RangeError);
    for (const value of [NaN, Infinity, -1, 0.5, 1_000_001])
      expect(
        () => new SessionService(undefined, { maxPointsPerQuestion: value }),
      ).toThrow(RangeError);
  });

  it('utiliza la duración y puntos configurados', () => {
    service = new SessionService(undefined, {
      now: () => now,
      questionDurationMs: 40000,
      maxPointsPerQuestion: 2000,
    });
    const { session, ana } = setup();
    service.startGame(session.id, session.teacherToken);
    now += 10000;
    answer(session.id, ana.id, 'ana-socket');
    service.closeQuestion(session.id, session.teacherToken);
    expect(
      service.getGameSnapshot(session.id, ana.id).self?.result,
    ).toMatchObject({ elapsedMs: 10000, points: 1500 });
  });
});
