import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import { Server } from 'socket.io';
import { readConfig, type AppConfig } from './config/env.ts';
import { NextcloudWebDavWorkbookStorage } from './nextcloud/nextcloud-webdav-workbook-storage.ts';
import {
  registerLobbyHandlers,
  type LobbyLog,
} from './realtime/lobby-handlers.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from './realtime/events.ts';
import { SessionService } from './services/session-service.ts';
import type { WorkbookStorage } from './services/workbook-storage.ts';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

interface ApplicationOptions {
  config?: AppConfig;
  workbookStorage?: WorkbookStorage;
  sessions?: SessionService;
  logger?: (entry: LobbyLog) => void;
}

export function createApplication(options: ApplicationOptions = {}) {
  const config = options.config ?? readConfig({});
  const sessions = options.sessions ?? new SessionService();
  const storage =
    options.workbookStorage ??
    (config.nextcloud
      ? new NextcloudWebDavWorkbookStorage(config.nextcloud)
      : undefined);
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
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        const url = new URL(origin);
        callback(
          null,
          ['http:', 'https:'].includes(url.protocol) &&
            url.host === request.headers.host,
        );
      } catch {
        callback(null, false);
      }
    },
  });
  registerLobbyHandlers(io, {
    sessions,
    storage,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const cleanup = setInterval(() => {
    sessions.cleanupExpired({
      sessionTtlMs: config.sessionTtlMs,
      finishedSessionTtlMs: config.finishedSessionTtlMs,
    });
  }, 60_000);
  cleanup.unref();
  httpServer.once('close', () => clearInterval(cleanup));

  return { app, httpServer, io };
}
