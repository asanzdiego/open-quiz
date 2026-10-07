import { createServer, type IncomingMessage } from 'node:http';
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
  const sessions =
    options.sessions ??
    new SessionService(undefined, {
      questionDurationMs: config.questionDurationMs,
      maxPointsPerQuestion: config.maxPointsPerQuestion,
      maxSessions: config.maxSessions,
      maxParticipantsPerSession: config.maxParticipantsPerSession,
    });
  const storage =
    options.workbookStorage ??
    (config.nextcloud
      ? new NextcloudWebDavWorkbookStorage(config.nextcloud)
      : undefined);
  const app = express();
  app.disable('x-powered-by');
  const securityHeaders = {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  function headersFor(request: IncomingMessage) {
    let connections = "'self'";
    try {
      const url = new URL(
        config.publicOrigin ?? `http://${request.headers.host}`,
      );
      if (
        config.publicOrigin ||
        url.host === request.headers.host?.toLowerCase()
      )
        connections += config.publicOrigin
          ? ` ${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`
          : ` ws://${url.host} wss://${url.host}`;
    } catch {
      /* No construir una política con un Host inválido. */
    }
    return {
      ...securityHeaders,
      'Content-Security-Policy': securityHeaders[
        'Content-Security-Policy'
      ].replace("connect-src 'self'", `connect-src ${connections}`),
    };
  }
  app.use((request, response, next) => {
    response.set(headersFor(request));
    next();
  });

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
      if (io.engine.clientsCount >= config.maxConnections) {
        callback(null, false);
        return;
      }
      const origin = request.headers.origin;
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        const url = new URL(origin);
        callback(
          null,
          origin === url.origin &&
            ['http:', 'https:'].includes(url.protocol) &&
            (config.publicOrigin
              ? origin === config.publicOrigin
              : url.host === request.headers.host),
        );
      } catch {
        callback(null, false);
      }
    },
  });
  // Engine.IO procesa el handshake antes de Express.
  io.engine.on(
    'headers',
    (headers: Record<string, string>, request: IncomingMessage) => {
      Object.assign(headers, headersFor(request));
    },
  );
  // El bundle de Socket.IO también se sirve antes del middleware de Express.
  httpServer.prependListener('request', (request, response) => {
    for (const [name, value] of Object.entries(headersFor(request)))
      response.setHeader(name, value);
  });
  const realtime = registerLobbyHandlers(io, {
    sessions,
    storage,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const cleanupSessions = () => {
    sessions.cleanupExpired({
      sessionTtlMs: config.sessionTtlMs,
      finishedSessionTtlMs: config.finishedSessionTtlMs,
      onExpired: realtime.expireSession,
    });
    realtime.pruneTimers();
  };
  const cleanup = setInterval(cleanupSessions, 60_000);
  cleanup.unref();
  httpServer.once('close', () => {
    clearInterval(cleanup);
    realtime.dispose();
  });

  return { app, httpServer, io, cleanupSessions };
}
