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
});
createGameView('teacher', socket, () => credentials);

document.getElementById('session-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send('teacher:create-session', {
    workbookReference: document
      .getElementById('workbook-reference')
      .value.trim(),
  });
});
