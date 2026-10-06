import { createLobbyConnection } from './lobby.js';
import { createGameView } from './game.js';

const input = document.getElementById('join-code-input');
const code = new URLSearchParams(window.location.search).get('code');
if (code) input.value = code.trim().toUpperCase().slice(0, 6);

const { send, socket } = createLobbyConnection('student', (session) => {
  document.getElementById('joined-nick').textContent = session.nick;
  document.getElementById('player-label').textContent = session.nick;
});
createGameView('student', socket);

document.getElementById('session-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const nick = document.getElementById('nick');
  const length = [...nick.value.trim().normalize('NFC')].length;
  nick.setCustomValidity(
    length === 0 || length > 24
      ? 'El nick debe tener entre 1 y 24 caracteres.'
      : '',
  );
  if (!nick.reportValidity()) return;
  send('student:join', {
    joinCode: input.value.trim().toUpperCase(),
    nick: document.getElementById('nick').value.trim(),
  });
});

document.getElementById('nick').addEventListener('input', (event) => {
  event.target.setCustomValidity('');
});
