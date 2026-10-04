import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import { Server } from 'socket.io';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

export function createApplication() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  app.use(express.static(publicDirectory));

  app.use((_request, response) => {
    response.status(404).json({ error: 'Recurso no encontrado.' });
  });

  const handleError: ErrorRequestHandler = (
    _error,
    _request,
    response,
    _next,
  ) => {
    response
      .status(500)
      .json({ error: 'Se ha producido un error en el servidor.' });
  };
  app.use(handleError);

  const httpServer = createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 16 * 1024 });

  return { app, httpServer, io };
}
