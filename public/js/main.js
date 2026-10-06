import { setConnectionStatus } from './ui.js';

const statusElement = document.getElementById('connection-status');
const socket = io();

socket.on('connect', () => {
  setConnectionStatus(
    statusElement,
    'connected',
    'Conexión en tiempo real disponible.',
  );
});

socket.on('disconnect', () => {
  setConnectionStatus(
    statusElement,
    'disconnected',
    'Conexión interrumpida. Intentando reconectar…',
  );
});

socket.on('connect_error', () => {
  setConnectionStatus(
    statusElement,
    'disconnected',
    'No se ha podido conectar. Intentando de nuevo…',
  );
});
