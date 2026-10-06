import { createLobbyConnection } from './lobby.js';
import { createGameView } from './game.js';

let credentials;
const { send, socket } = createLobbyConnection('teacher', (session) => {
  credentials = {
    sessionId: session.sessionId,
    teacherToken: session.teacherToken,
  };
  document.getElementById('join-code').textContent = session.joinCode;
  document.getElementById('question-count').textContent =
    `${session.lobby.questionCount} preguntas cargadas.`;
  const url = new URL('/student.html', window.location.origin);
  url.searchParams.set('code', session.joinCode);
  const link = document.getElementById('student-link');
  link.href = url.href;
  link.textContent = url.href;
  document
    .getElementById('join-code')
    .setAttribute(
      'aria-label',
      `Código de partida: ${session.joinCode.split('').join(' ')}`,
    );
});

for (const [buttonId, targetId, label] of [
  ['copy-code', 'join-code', 'Código copiado.'],
  ['copy-link', 'student-link', 'Enlace copiado.'],
]) {
  document.getElementById(buttonId).addEventListener('click', async () => {
    const feedback = document.getElementById('share-feedback');
    try {
      await navigator.clipboard.writeText(
        document.getElementById(targetId).textContent,
      );
      feedback.textContent = label;
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(targetId));
      selection.removeAllRanges();
      selection.addRange(range);
      feedback.textContent =
        'No se ha podido copiar automáticamente. El texto está seleccionado: cópialo o compártelo manualmente.';
    }
  });
}
createGameView('teacher', socket, () => credentials);

document.getElementById('session-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send('teacher:create-session', {
    workbookReference: document
      .getElementById('workbook-reference')
      .value.trim(),
  });
});
