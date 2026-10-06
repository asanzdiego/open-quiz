import { focusHeading, setConnectionStatus } from './ui.js';

export function renderLobby(lobby) {
  const list = document.getElementById('participants');
  list.replaceChildren(
    ...lobby.participants.map((participant) => {
      const row = document.createElement('li');
      row.className = 'participant';
      row.dataset.connected = String(participant.connected);
      const name = document.createElement('span');
      name.className = 'participant-name';
      name.textContent = participant.nick;
      const state = document.createElement('span');
      state.className = 'participant-state';
      state.textContent = participant.connected ? 'Conectado' : 'Desconectado';
      row.append(name, state);
      return row;
    }),
  );
  const connected = lobby.participants.filter(
    (participant) => participant.connected,
  ).length;
  document.getElementById('participant-count').textContent =
    `${connected} conectados · ${lobby.participants.length} participantes`;
  document.getElementById('lobby-empty').hidden = lobby.participants.length > 0;
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
  function setPending(value, restoring = false) {
    pending = value;
    submit.disabled = value || !socket.connected;
    form.setAttribute('aria-busy', String(value));
    submit.textContent = value
      ? restoring
        ? 'Recuperando tu partida…'
        : role === 'teacher'
          ? 'Cargando cuestionario…'
          : 'Entrando…'
      : role === 'teacher'
        ? 'Crear partida'
        : 'Entrar';
  }
  function clearError() {
    error.hidden = true;
    for (const input of form.querySelectorAll('input')) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-errormessage');
    }
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
    clearError();
    retry.hidden = true;
    setPending(true, true);
    setConnectionStatus(status, 'connecting', 'Recuperando tu partida…');
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
    clearError();
    retry.hidden = true;
    setConnectionStatus(status, 'connected', 'Conectado a la partida.');
    onReady(payload);
    renderLobby(payload.lobby);
    focusHeading(document.getElementById('lobby-title'));
  }
  socket.on('connect', () => {
    setConnectionStatus(
      status,
      'connected',
      'Conexión en tiempo real disponible.',
    );
    retry.hidden = true;
    setPending(false);
    if (saved) restore();
  });
  socket.on('disconnect', (reason) => {
    setPending(false);
    retry.hidden = reason !== 'io server disconnect';
    setConnectionStatus(
      status,
      'disconnected',
      reason === 'io server disconnect'
        ? 'Esta partida se ha abierto en otra pestaña. Puedes reconectar aquí para continuar.'
        : 'Conexión interrumpida. Intentando reconectar…',
    );
  });
  socket.on('connect_error', () => {
    setPending(false);
    retry.hidden = false;
    setConnectionStatus(
      status,
      'disconnected',
      'No se ha podido conectar. Intentando de nuevo…',
    );
  });
  socket.on('app:error', (payload) => {
    // Un segundo envío rechazado no cancela la primera operación en curso.
    if (payload.code === 'OPERATION_IN_PROGRESS') return;
    setPending(false);
    error.textContent = payload.message;
    error.hidden = false;
    const field = ['NICK_TAKEN', 'INVALID_NICK'].includes(payload.code)
      ? document.getElementById('nick')
      : ['SESSION_NOT_FOUND', 'INVALID_JOIN_CODE'].includes(payload.code)
        ? document.getElementById('join-code-input')
        : payload.operation === 'teacher:create-session'
          ? document.getElementById('workbook-reference')
          : null;
    if (field && !form.hidden) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-errormessage', 'form-error');
    }
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
        document.getElementById('page-title').textContent =
          role === 'teacher' ? 'Crear partida' : 'Entrar a la partida';
        document.title = `${role === 'teacher' ? 'Crear partida' : 'Entrar como alumno'} · Open Quiz`;
        setConnectionStatus(
          status,
          'connected',
          'Conectado al servidor. Puedes entrar a una nueva partida.',
        );
      } else {
        retry.hidden = false;
      }
    }
    focusHeading(error);
  });
  for (const event of role === 'teacher'
    ? ['session:created', 'session:restored']
    : ['student:joined', 'student:restored'])
    socket.on(event, ready);
  socket.on('lobby:updated', renderLobby);
  retry.addEventListener('click', () => {
    if (socket.connected) restore();
    else socket.connect();
  });
  document.getElementById('new-session').addEventListener('click', () => {
    persist(null);
    socket.disconnect();
    window.location.assign(`/${role}.html`);
  });
  form.addEventListener('input', clearError);
  socket.connect();

  function send(event, payload) {
    if (!socket.connected || pending) return;
    clearError();
    setPending(true);
    socket.emit(event, payload);
  }
  return { send, socket };
}
