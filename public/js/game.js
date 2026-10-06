import { focusHeading, renderMetrics } from './ui.js';

export function createGameView(role, socket, getCredentials) {
  const element = (id) => document.getElementById(id);
  const controls = [...document.querySelectorAll('[data-game-event]')];
  const labels = new Map(
    controls.map((button) => [button, button.textContent.trim()]),
  );
  let state = 'LOBBY';
  let question = null;
  let result = null;
  let ownResult = null;
  let ranking = [];
  let participantId = null;
  let hasAnswered = false;
  let selectedOptionId = null;
  let pending = false;
  let pendingEvent = null;
  let synced = false;
  let clockOffset = 0;
  let countdown;
  let workbookSave = null;
  let renderedState = null;
  let renderedQuestionId = null;
  let warned = false;

  const text = (target, value) => {
    if (target.textContent !== value) target.textContent = value;
  };
  function finishPending() {
    pending = false;
    pendingEvent = null;
  }
  function remaining() {
    return question
      ? Math.max(0, question.endsAt - (Date.now() + clockOffset))
      : 0;
  }
  function updateFeedback() {
    if (role !== 'student' || state !== 'QUESTION_ACTIVE') return;
    const feedback = element('answer-feedback');
    feedback.dataset.state = hasAnswered
      ? 'sent'
      : pending
        ? 'sending'
        : 'waiting';
    text(
      feedback,
      hasAnswered
        ? 'Respuesta enviada. Espera a que termine la pregunta.'
        : !socket.connected || !synced
          ? 'Recuperando la conexión. Espera para responder.'
          : remaining() <= 0
            ? 'Tiempo agotado. Esperando resultados…'
            : pending
              ? 'Enviando respuesta…'
              : 'Elige una respuesta. Solo puedes enviar una.',
    );
  }
  function updateAnswers() {
    for (const option of element('answer-options').children) {
      const selected = option.dataset.optionId === selectedOptionId;
      const correct =
        state === 'QUESTION_RESULTS' &&
        option.dataset.optionId === result?.correctOptionId;
      option.dataset.selected = String(selected);
      option.dataset.correct = String(correct);
      const tag = option.querySelector('.answer-tag');
      tag.hidden = !selected && !correct;
      text(
        tag,
        correct
          ? selected
            ? '✓ Respuesta correcta · Tu respuesta'
            : '✓ Respuesta correcta'
          : selected
            ? hasAnswered
              ? 'Tu respuesta'
              : 'Enviando…'
            : '',
      );
      if (role === 'student') {
        option.disabled =
          !socket.connected ||
          !synced ||
          pending ||
          hasAnswered ||
          state !== 'QUESTION_ACTIVE' ||
          remaining() <= 0;
        option.setAttribute('aria-pressed', String(selected));
      }
    }
  }
  function updateButtons() {
    for (const button of controls) {
      const needsSave =
        state === 'QUESTION_RESULTS' &&
        ['teacher:start-next-question', 'teacher:end-game'].includes(
          button.dataset.gameEvent,
        );
      button.disabled =
        !socket.connected ||
        !synced ||
        pending ||
        (needsSave && workbookSave?.status !== 'saved');
      const busy = pending && pendingEvent === button.dataset.gameEvent;
      button.setAttribute('aria-busy', String(busy));
      text(
        button,
        busy
          ? button.dataset.gameEvent === 'teacher:retry-save-results'
            ? 'Reintentando guardado…'
            : 'Espera…'
          : button.id === 'end-game' && !result?.hasNextQuestion
            ? 'Ver podio y finalizar'
            : labels.get(button),
      );
    }
    updateAnswers();
    updateFeedback();
  }
  function tick() {
    const left = remaining();
    const seconds = Math.ceil(left / 1000);
    text(element('countdown'), `${seconds} s`);
    element('time-progress').value =
      question.durationMs > 0
        ? Math.min(100, (left / question.durationMs) * 100)
        : 0;
    element('time-progress').setAttribute(
      'aria-valuetext',
      `${seconds} segundos restantes`,
    );
    element('countdown-panel').dataset.urgent = String(left <= 5000);
    if (!warned && left > 0 && left <= 5000) {
      warned = true;
      text(element('timer-announcement'), `Quedan ${seconds} segundos.`);
    }
    if (left === 0)
      text(
        element('timer-announcement'),
        'Tiempo agotado. Esperando resultados.',
      );
    updateButtons();
  }
  function renderRanking(entries, target) {
    element(target).replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement('li');
        row.className = target === 'podium' ? 'podium-place' : 'ranking-row';
        row.dataset.position = String(entry.position);
        row.dataset.self = String(entry.participantId === participantId);
        const position = document.createElement('span');
        position.className = 'rank-position';
        position.textContent = `${entry.position}`;
        position.setAttribute('aria-label', `Puesto ${entry.position}`);
        const name = document.createElement('span');
        name.className = 'rank-name';
        name.textContent = entry.nick;
        if (entry.participantId === participantId) {
          const self = document.createElement('span');
          self.className = 'self-tag';
          self.textContent = 'Tú';
          name.append(self);
        }
        const points = document.createElement('span');
        points.className = 'rank-points';
        points.textContent = entry.totalPoints.toLocaleString('es-ES');
        const caption = document.createElement('small');
        caption.textContent = 'puntos';
        points.append(caption);
        row.append(position, name, points);
        return row;
      }),
    );
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'Todavía no hay participantes en la clasificación.';
      element(target).append(empty);
    }
  }
  function renderSelf(own) {
    if (role !== 'student') return;
    ownResult = own;
    const verdict = element('student-result');
    if (!own) {
      verdict.textContent = 'Recibiendo tu resultado…';
      verdict.removeAttribute('data-correct');
      element('student-metrics').replaceChildren();
      return;
    }
    verdict.dataset.correct = String(own.isCorrect);
    verdict.textContent = own.answered
      ? own.isCorrect
        ? '✓ ¡Respuesta correcta!'
        : '× Respuesta incorrecta'
      : '— No has respondido';
    renderMetrics(element('student-metrics'), [
      ['Puntos de pregunta', `+${own.points.toLocaleString('es-ES')}`],
      ['Puntos totales', own.totalPoints.toLocaleString('es-ES')],
      ['Tu puesto', `${own.position}º`],
    ]);
  }
  function renderWorkbookSave() {
    if (role !== 'teacher') return;
    const status = element('workbook-save-status');
    status.hidden = !workbookSave && state !== 'FINISHED';
    status.dataset.state = workbookSave?.status ?? 'empty';
    text(
      status,
      !workbookSave
        ? state === 'FINISHED'
          ? 'No se han cerrado preguntas; no hay resultados para guardar.'
          : ''
        : workbookSave.status === 'saved'
          ? state === 'FINISHED'
            ? 'Los resultados se han guardado en Nextcloud.'
            : `Resultados guardados en Nextcloud: ${workbookSave.worksheetName}.`
          : workbookSave.status === 'error'
            ? `${workbookSave.error.message} La clasificación se conserva. Reintenta el guardado para continuar.`
            : `Guardando ${workbookSave.worksheetName} en Nextcloud… Podrás continuar cuando termine.`,
    );
    element('retry-save-results').hidden = workbookSave?.status !== 'error';
  }
  function render(focusRestoredView = false) {
    clearInterval(countdown);
    document.body.dataset.gameState = state;
    element('lobby').hidden = state !== 'LOBBY';
    element('game').hidden = state === 'LOBBY';
    element('page-title').textContent =
      state === 'LOBBY'
        ? role === 'teacher'
          ? 'Tu partida está lista'
          : 'Ya estás dentro'
        : state === 'FINISHED'
          ? 'Partida terminada'
          : state === 'QUESTION_RESULTS'
            ? 'Así va la clase'
            : '¡Vamos con la pregunta!';
    document.title = `${element('page-title').textContent} · Open Quiz`;
    element('game-title').textContent =
      state === 'FINISHED'
        ? 'Resultados finales'
        : state === 'QUESTION_RESULTS'
          ? 'Resultados de la pregunta'
          : 'Pregunta en curso';
    element('question-panel').hidden = state === 'FINISHED';
    element('countdown-panel').hidden = state !== 'QUESTION_ACTIVE';
    element('question-result').hidden = state !== 'QUESTION_RESULTS';
    element('ranking-panel').hidden =
      state !== 'QUESTION_RESULTS' && state !== 'FINISHED';
    element('podium-panel').hidden = state !== 'FINISHED';
    element('new-session').hidden = state !== 'FINISHED';
    element('answer-feedback').hidden =
      role !== 'student' || state !== 'QUESTION_ACTIVE';
    if (state !== 'QUESTION_ACTIVE') text(element('timer-announcement'), '');
    if (question) {
      element('question-number').textContent =
        `Pregunta ${question.questionNumber} de ${question.questionCount}`;
      element('question-text').textContent = question.text;
      element('answer-options').replaceChildren(
        ...question.options.map((option, index) => {
          const card = document.createElement(
            role === 'student' ? 'button' : 'div',
          );
          card.className = 'answer';
          card.dataset.optionId = option.id;
          if (role === 'student') card.type = 'button';
          const letter = document.createElement('span');
          letter.className = 'answer-letter';
          letter.textContent = ['A', 'B', 'C', 'D'][index];
          const content = document.createElement('span');
          content.className = 'answer-content';
          const label = document.createElement('span');
          label.textContent = option.text;
          const tag = document.createElement('span');
          tag.className = 'answer-tag';
          tag.hidden = true;
          content.append(label, tag);
          card.append(letter, content);
          if (role === 'student')
            card.addEventListener('click', () => {
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
              selectedOptionId = option.id;
              element('form-error').hidden = true;
              updateButtons();
              socket.emit('student:answer', {
                questionId: question.questionId,
                answerOptionId: option.id,
              });
            });
          return card;
        }),
      );
    }
    if (result) {
      element('correct-answer').textContent =
        `Respuesta correcta: ${result.correctAnswer}`;
      renderMetrics(element('question-statistics'), [
        ['Aciertos', result.correctCount.toLocaleString('es-ES')],
        ['Respuestas', `${result.answeredCount} / ${result.participantCount}`],
        [
          'Sin respuesta',
          String(result.participantCount - result.answeredCount),
        ],
      ]);
    }
    renderSelf(ownResult);
    renderRanking(ranking, 'ranking');
    if (role === 'teacher') {
      element('answer-count').parentElement.hidden =
        state !== 'QUESTION_ACTIVE';
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
          ? `Tu puesto: ${own.position}º · ${own.totalPoints.toLocaleString('es-ES')} puntos`
          : '';
      }
    }
    if (state === 'QUESTION_ACTIVE') {
      tick();
      countdown = setInterval(tick, 250);
    }
    renderWorkbookSave();
    updateButtons();
    if (
      focusRestoredView ||
      renderedState !== state ||
      renderedQuestionId !== question?.questionId
    ) {
      focusHeading(element(state === 'LOBBY' ? 'lobby-title' : 'game-title'));
    }
    renderedState = state;
    renderedQuestionId = question?.questionId;
  }

  for (const button of controls)
    button.addEventListener('click', () => {
      if (button.disabled || !socket.connected || !synced || pending) return;
      pending = true;
      pendingEvent = button.dataset.gameEvent;
      element('form-error').hidden = true;
      updateButtons();
      socket.emit(pendingEvent, getCredentials());
    });
  socket.on('game:updated', (snapshot) => {
    synced = true;
    finishPending();
    state = snapshot.state;
    question = snapshot.question;
    result = snapshot.result;
    ranking = snapshot.ranking;
    participantId = snapshot.self?.participantId ?? null;
    hasAnswered = snapshot.self?.hasAnswered ?? false;
    selectedOptionId = snapshot.self?.answerOptionId ?? null;
    ownResult = snapshot.self?.result ?? null;
    clockOffset = snapshot.serverNow - Date.now();
    workbookSave = snapshot.workbookSave;
    warned = false;
    render(true);
    if (snapshot.progress) renderProgress(snapshot.progress);
  });
  socket.on('question:started', (payload) => {
    state = 'QUESTION_ACTIVE';
    question = payload;
    result = null;
    ownResult = null;
    finishPending();
    hasAnswered = false;
    selectedOptionId = null;
    workbookSave = null;
    warned = false;
    clockOffset = payload.startedAt - Date.now();
    text(element('timer-announcement'), '');
    render();
  });
  function renderProgress(progress) {
    if (role !== 'teacher' || progress.questionId !== question?.questionId)
      return;
    text(
      element('answer-count'),
      `${progress.answeredCount} de ${progress.participantCount} han respondido`,
    );
    element('response-progress').max = Math.max(1, progress.participantCount);
    element('response-progress').value = progress.answeredCount;
    element('response-progress').setAttribute(
      'aria-valuetext',
      element('answer-count').textContent,
    );
  }
  socket.on('question:progress', renderProgress);
  socket.on('answer:accepted', (payload) => {
    if (
      payload.questionId !== question?.questionId ||
      state !== 'QUESTION_ACTIVE'
    )
      return;
    finishPending();
    hasAnswered = true;
    selectedOptionId = payload.answerOptionId;
    updateButtons();
  });
  socket.on('question:ended', (payload) => {
    finishPending();
    state = 'QUESTION_RESULTS';
    result = payload;
    ownResult = null;
    if (role === 'teacher')
      workbookSave = {
        questionNumber: payload.questionNumber,
        worksheetName: `P${String(payload.questionNumber).padStart(2, '0')}`,
        status: 'pending',
        error: null,
      };
    render();
  });
  socket.on('ranking:updated', (payload) => {
    ranking = payload;
    renderRanking(ranking, 'ranking');
  });
  socket.on('student:result', renderSelf);
  socket.on('workbook:save-updated', (payload) => {
    workbookSave = payload;
    if (payload.status !== 'saving') finishPending();
    renderWorkbookSave();
    updateButtons();
  });
  socket.on('game:ended', (payload) => {
    finishPending();
    state = 'FINISHED';
    ranking = payload.ranking;
    render();
  });
  socket.on('app:error', (payload) => {
    if (payload.code === 'OPERATION_IN_PROGRESS') return;
    finishPending();
    if (
      payload.operation === `${role}:reconnect` &&
      [
        'SESSION_NOT_FOUND',
        'PARTICIPANT_NOT_FOUND',
        'INVALID_RECONNECT_TOKEN',
        'INVALID_TEACHER_TOKEN',
        'INVALID_PAYLOAD',
      ].includes(payload.code)
    ) {
      clearInterval(countdown);
      state = 'LOBBY';
      question = null;
      result = null;
      ownResult = null;
      ranking = [];
      hasAnswered = false;
      selectedOptionId = null;
      synced = false;
      renderedState = null;
      renderedQuestionId = null;
      document.body.dataset.gameState = 'ENTRY';
    }
    if (!hasAnswered) selectedOptionId = null;
    updateButtons();
  });
  for (const event of ['connect', 'disconnect'])
    socket.on(event, () => {
      synced = false;
      finishPending();
      updateButtons();
    });
}
