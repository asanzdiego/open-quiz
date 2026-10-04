const statusElement = document.getElementById('connection-status');
const socket = io();

socket.on('connect', () => {
  statusElement.textContent = 'Conexión en tiempo real disponible.';
});

socket.on('disconnect', () => {
  statusElement.textContent = 'Conexión interrumpida. Intentando reconectar…';
});

socket.on('connect_error', () => {
  statusElement.textContent = 'No se ha podido conectar. Intentando de nuevo…';
});
