export function renderLobby(lobby) {
  const list = document.getElementById('participants');
  const rows = lobby.participants.map((participant) => {
    const row = document.createElement('li');
    row.textContent = `${participant.nick} · ${participant.connected ? 'Conectado' : 'Desconectado'}`;
    return row;
  });
  list.replaceChildren(...rows);
  const connected = lobby.participants.filter(
    (participant) => participant.connected,
  ).length;
  document.getElementById('participant-count').textContent =
    `${connected} conectados · ${lobby.participants.length} participantes`;
}

export function createLobbyConnection(role, onReady) {
  const status = document.getElementById('connection-status');
  const error = document.getElementById('form-error');
  const warning = document.getElementById('storage-warning');
  const retry = document.getElementById('retry-restore');
  const form = document.getElementById('session-form');
  const lobby = document.getElementById('lobby');
  const submit = document.getElementById('submit-button');
  const key = `open-quiz.${role}`;
  const restoreEvent = `${role}:reconnect`;
  let saved = null;
  let pending = false;
  let storage;
  try {
    storage = role === 'teacher' ? window.sessionStorage : window.localStorage;
    saved = JSON.parse(storage.getItem(key));
    if (saved && (typeof saved !== 'object' || Array.isArray(saved)))
      saved = null;
  } catch {
    saved = null;
  }

  const socket = io({ autoConnect: false });
  function setPending(value) {
    pending = value;
    submit.disabled = value || !socket.connected;
    form.setAttribute('aria-busy', String(value));
    submit.textContent = value
      ? 'Conectando con la partida…'
      : role === 'teacher'
        ? 'Crear partida'
        : 'Entrar';
  }
  function persist(value) {
    saved = value;
    try {
      if (value) storage.setItem(key, JSON.stringify(value));
      else storage.removeItem(key);
    } catch {
      warning.hidden = false;
      warning.textContent =
        'El navegador no permite guardar la reconexión. Conserva esta página abierta.';
    }
  }
  function restore() {
    if (!saved || !socket.connected || pending) return;
    error.hidden = true;
    retry.hidden = true;
    setPending(true);
    socket.emit(
      restoreEvent,
      role === 'teacher'
        ? { sessionId: saved.sessionId, teacherToken: saved.teacherToken }
        : {
            joinCode: saved.joinCode,
            participantId: saved.participantId,
            reconnectToken: saved.reconnectToken,
          },
    );
  }
  function ready(payload) {
    persist(
      role === 'teacher'
        ? {
            sessionId: payload.sessionId,
            joinCode: payload.joinCode,
            teacherToken: payload.teacherToken,
          }
        : {
            joinCode: payload.joinCode,
            participantId: payload.participantId,
            reconnectToken: payload.reconnectToken,
          },
    );
    setPending(false);
    form.hidden = true;
    lobby.hidden = false;
    error.hidden = true;
    retry.hidden = true;
    status.textContent = 'Conectado a la partida.';
    onReady(payload);
    renderLobby(payload.lobby);
  }
  socket.on('connect', () => {
    status.textContent = 'Conexión en tiempo real disponible.';
    setPending(false);
    if (saved) restore();
  });
  socket.on('disconnect', (reason) => {
    setPending(false);
    retry.hidden = true;
    status.textContent =
      reason === 'io server disconnect'
        ? 'La partida se ha abierto en otra pestaña. Esta conexión se ha cerrado.'
        : 'Conexión interrumpida. Intentando reconectar…';
  });
  socket.on('connect_error', () => {
    setPending(false);
    status.textContent = 'No se ha podido conectar. Intentando de nuevo…';
  });
  socket.on('app:error', (payload) => {
    // Un segundo envío rechazado no cancela la primera operación en curso.
    if (payload.code === 'OPERATION_IN_PROGRESS') return;
    setPending(false);
    error.textContent = payload.message;
    error.hidden = false;
    if (payload.operation === restoreEvent) {
      const expired = [
        'SESSION_NOT_FOUND',
        'PARTICIPANT_NOT_FOUND',
        'INVALID_RECONNECT_TOKEN',
        'INVALID_TEACHER_TOKEN',
        'INVALID_PAYLOAD',
      ].includes(payload.code);
      if (expired) {
        persist(null);
        form.hidden = false;
        lobby.hidden = true;
        document.getElementById('game').hidden = true;
      } else {
        retry.hidden = false;
      }
    }
  });
  for (const event of role === 'teacher'
    ? ['session:created', 'session:restored']
    : ['student:joined', 'student:restored'])
    socket.on(event, ready);
  socket.on('lobby:updated', renderLobby);
  retry.addEventListener('click', restore);
  socket.connect();

  function send(event, payload) {
    if (!socket.connected || pending) return;
    error.hidden = true;
    setPending(true);
    socket.emit(event, payload);
  }
  return { send, socket };
}
