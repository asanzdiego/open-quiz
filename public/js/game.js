export function createGameView(role, socket, getCredentials) {
  const element = (id) => document.getElementById(id);
  let state = 'LOBBY';
  let question = null;
  let result = null;
  let ranking = [];
  let participantId = null;
  let hasAnswered = false;
  let pending = false;
  let synced = false;
  let clockOffset = 0;
  let countdown;

  function updateButtons() {
    const disabled = !socket.connected || !synced || pending;
    for (const button of document.querySelectorAll('[data-game-event]'))
      button.disabled = disabled;
    for (const button of element('answer-options').children)
      button.disabled =
        disabled ||
        role === 'teacher' ||
        hasAnswered ||
        state !== 'QUESTION_ACTIVE' ||
        remaining() <= 0;
  }
  function remaining() {
    return question
      ? Math.max(0, question.endsAt - (Date.now() + clockOffset))
      : 0;
  }
  function tick() {
    element('countdown').textContent = `${Math.ceil(remaining() / 1000)} s`;
    updateButtons();
  }
  function renderRanking(entries, target) {
    element(target).replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement('li');
        row.textContent = `${entry.position}. ${entry.nick} · ${entry.totalPoints} puntos`;
        return row;
      }),
    );
  }
  function renderSelf(own) {
    if (role !== 'student' || !own) return;
    element('student-result').textContent =
      `${own.answered ? (own.isCorrect ? 'Correcto' : 'Incorrecto') : 'Sin respuesta'} · ${own.points} puntos en esta pregunta · Total: ${own.totalPoints} · Puesto: ${own.position}`;
  }
  function render() {
    clearInterval(countdown);
    element('lobby').hidden = state !== 'LOBBY';
    element('game').hidden = state === 'LOBBY';
    element('game-title').textContent =
      state === 'FINISHED'
        ? 'Partida terminada'
        : state === 'QUESTION_RESULTS'
          ? 'Resultados de la pregunta'
          : 'Pregunta en curso';
    element('question-panel').hidden = state === 'FINISHED';
    element('countdown-panel').hidden = state !== 'QUESTION_ACTIVE';
    element('question-result').hidden = state !== 'QUESTION_RESULTS';
    element('ranking-panel').hidden =
      state !== 'QUESTION_RESULTS' && state !== 'FINISHED';
    element('podium-panel').hidden = state !== 'FINISHED';
    element('answer-feedback').hidden =
      role !== 'student' || state !== 'QUESTION_ACTIVE';
    element('answer-feedback').textContent = hasAnswered
      ? 'Respuesta enviada'
      : pending
        ? 'Enviando respuesta…'
        : 'Elige una respuesta.';
    if (question) {
      element('question-number').textContent =
        `Pregunta ${question.questionNumber} de ${question.questionCount}`;
      element('question-text').textContent = question.text;
      element('answer-options').replaceChildren(
        ...question.options.map((option, index) => {
          const button = document.createElement('button');
          button.className = 'button answer';
          button.textContent = `${index + 1}. ${option.text}`;
          if (
            state === 'QUESTION_RESULTS' &&
            option.id === result?.correctOptionId
          )
            button.textContent += ' · Respuesta correcta';
          if (role === 'student')
            button.addEventListener('click', () => {
              if (
                pending ||
                hasAnswered ||
                !synced ||
                !socket.connected ||
                state !== 'QUESTION_ACTIVE' ||
                remaining() <= 0
              )
                return;
              pending = true;
              element('form-error').hidden = true;
              element('answer-feedback').textContent = 'Enviando respuesta…';
              updateButtons();
              socket.emit('student:answer', {
                questionId: question.questionId,
                answerOptionId: option.id,
              });
            });
          return button;
        }),
      );
    }
    if (result) {
      element('correct-answer').textContent =
        `Respuesta correcta: ${result.correctAnswer}`;
      element('question-statistics').textContent =
        `${result.correctCount} aciertos · ${result.answeredCount} respuestas de ${result.participantCount} participantes`;
    }
    renderRanking(ranking, 'ranking');
    if (role === 'teacher') {
      element('close-question').hidden = state !== 'QUESTION_ACTIVE';
      element('next-question').hidden =
        state !== 'QUESTION_RESULTS' || !result?.hasNextQuestion;
      element('end-game').hidden = state !== 'QUESTION_RESULTS';
    }
    if (state === 'FINISHED') {
      renderRanking(ranking.slice(0, 3), 'podium');
      if (role === 'student') {
        const own = ranking.find(
          (entry) => entry.participantId === participantId,
        );
        element('final-score').textContent = own
          ? `Puesto ${own.position} · ${own.totalPoints} puntos`
          : '';
      }
    }
    if (state === 'QUESTION_ACTIVE') {
      tick();
      countdown = setInterval(tick, 250);
    }
    updateButtons();
  }

  for (const button of document.querySelectorAll('[data-game-event]')) {
    button.addEventListener('click', () => {
      if (!socket.connected || !synced || pending) return;
      pending = true;
      element('form-error').hidden = true;
      updateButtons();
      socket.emit(button.dataset.gameEvent, getCredentials());
    });
  }
  socket.on('game:updated', (snapshot) => {
    synced = true;
    pending = false;
    state = snapshot.state;
    question = snapshot.question;
    result = snapshot.result;
    ranking = snapshot.ranking;
    participantId = snapshot.self?.participantId ?? null;
    hasAnswered = snapshot.self?.hasAnswered ?? false;
    clockOffset = snapshot.serverNow - Date.now();
    render();
    if (snapshot.progress) renderProgress(snapshot.progress);
    renderSelf(snapshot.self?.result);
  });
  socket.on('question:started', (payload) => {
    state = 'QUESTION_ACTIVE';
    question = payload;
    result = null;
    pending = false;
    hasAnswered = false;
    clockOffset = payload.startedAt - Date.now();
    render();
  });
  function renderProgress(progress) {
    if (role === 'teacher')
      element('answer-count').textContent =
        `${progress.answeredCount} de ${progress.participantCount} han respondido`;
  }
  socket.on('question:progress', renderProgress);
  socket.on('answer:accepted', (payload) => {
    if (payload.questionId !== question?.questionId) return;
    pending = false;
    hasAnswered = true;
    element('answer-feedback').textContent = 'Respuesta enviada';
    updateButtons();
  });
  socket.on('question:ended', (payload) => {
    pending = false;
    state = 'QUESTION_RESULTS';
    result = payload;
    render();
  });
  socket.on('ranking:updated', (payload) => {
    ranking = payload;
    renderRanking(ranking, 'ranking');
  });
  socket.on('student:result', renderSelf);
  socket.on('game:ended', (payload) => {
    pending = false;
    state = 'FINISHED';
    ranking = payload.ranking;
    render();
  });
  socket.on('app:error', (payload) => {
    if (payload.code === 'OPERATION_IN_PROGRESS') return;
    pending = false;
    if (state === 'QUESTION_ACTIVE' && role === 'student')
      element('answer-feedback').textContent = hasAnswered
        ? 'Respuesta enviada'
        : 'Elige una respuesta.';
    updateButtons();
  });
  for (const event of ['connect', 'disconnect'])
    socket.on(event, () => {
      synced = false;
      pending = false;
      updateButtons();
    });
}
