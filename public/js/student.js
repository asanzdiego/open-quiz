import { createLobbyConnection } from './lobby.js';
import { createGameView } from './game.js';

const input = document.getElementById('join-code-input');
const code = new URLSearchParams(window.location.search).get('code');
if (code) input.value = code.trim().toUpperCase().slice(0, 6);

const { send, socket } = createLobbyConnection('student', (session) => {
  document.getElementById('joined-nick').textContent = session.nick;
});
createGameView('student', socket);

document.getElementById('session-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send('student:join', {
    joinCode: input.value.trim().toUpperCase(),
    nick: document.getElementById('nick').value.trim(),
  });
});
