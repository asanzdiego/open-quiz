import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/app.ts';
import { readConfig } from '../src/config/env.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../src/realtime/events.ts';
import { createHttpsReverseProxy } from './helpers/https-reverse-proxy.ts';
import { InMemoryWorkbookStorage } from './helpers/in-memory-workbook-storage.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function nextEvent<K extends keyof ServerToClientEvents>(
  client: Client,
  event: K,
  accept: (payload: Parameters<ServerToClientEvents[K]>[0]) => boolean = () =>
    true,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, listener as never);
      reject(new Error(`No se ha recibido ${event} a través del proxy.`));
    }, 2500);
    const listener = (payload: Parameters<ServerToClientEvents[K]>[0]) => {
      if (!accept(payload)) return;
      clearTimeout(timer);
      client.off(event, listener as never);
      resolve(payload);
    };
    client.on(event, listener as never);
  });
}

describe('Fase 9: HTTP y Socket.IO detrás de un proxy HTTPS', () => {
  const storage = new InMemoryWorkbookStorage();
  const application = createApplication({
    config: readConfig({ NODE_ENV: 'production' }),
    workbookStorage: storage,
  });
  let proxy: Awaited<ReturnType<typeof createHttpsReverseProxy>>;
  let cert: string;

  beforeAll(async () => {
    const key = await readFile(
      new URL('./fixtures/proxy/key.pem', import.meta.url),
      'utf8',
    );
    cert = await readFile(
      new URL('./fixtures/proxy/cert.pem', import.meta.url),
      'utf8',
    );
    await storage.uploadWorkbook(
      'Quiz/proxy.xlsx',
      await readFile(
        new URL('./fixtures/excel/valid-header.xlsx', import.meta.url),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      application.httpServer.once('error', reject);
      application.httpServer.listen(0, '127.0.0.1', () => {
        application.httpServer.removeListener('error', reject);
        resolve();
      });
    });
    proxy = await createHttpsReverseProxy(
      (application.httpServer.address() as AddressInfo).port,
      { key, cert },
    );
  });

  afterAll(async () => {
    if (proxy) await proxy.close();
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
  });

  async function client(transport: 'polling' | 'websocket'): Promise<Client> {
    const socket: Client = connect(proxy.url, {
      ca: cert,
      extraHeaders: { Origin: proxy.url },
      transports: [transport],
      autoConnect: false,
      reconnection: false,
      timeout: 2000,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
      return socket;
    } catch (error) {
      socket.disconnect();
      throw error;
    }
  }

  it('sirve /health, el frontend y el cliente Socket.IO sobre HTTPS', async () => {
    const response = await request(proxy.url)
      .get('/health')
      .ca(cert)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({ status: 'ok' });
    for (const path of ['/', '/student.html', '/socket.io/socket.io.js']) {
      await request(proxy.url).get(path).ca(cert).expect(200);
    }
  });

  it.each(['polling', 'websocket'] as const)(
    'conecta mediante %s con el Origin y Host públicos',
    async (transport) => {
      const socket = await client(transport);
      try {
        expect(socket.connected).toBe(true);
        expect(socket.io.engine.transport.name).toBe(transport);
      } finally {
        socket.disconnect();
      }
    },
  );

  it('actualiza de polling a WebSocket a través de Upgrade', async () => {
    const socket = connect(proxy.url, {
      ca: cert,
      extraHeaders: { Origin: proxy.url },
      transports: ['polling', 'websocket'],
      autoConnect: false,
      reconnection: false,
      timeout: 2000,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Upgrade fallido.')), 2500);
        socket.once('connect_error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        socket.io.once('open', () => {
          socket.io.engine.once('upgrade', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        socket.connect();
      });
      expect(socket.io.engine.transport.name).toBe('websocket');
    } finally {
      socket.disconnect();
    }
  });

  it.each(['polling', 'websocket'] as const)(
    'rechaza un Origin externo mediante %s aunque falsifique X-Forwarded-Host',
    async (transport) => {
      const socket = connect(proxy.url, {
        ca: cert,
        extraHeaders: {
          Origin: 'https://externo.example.com',
          'X-Forwarded-Host': 'externo.example.com',
        },
        transports: [transport],
        autoConnect: false,
        reconnection: false,
        timeout: 2000,
      });
      try {
        await expect(
          new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
            socket.connect();
          }),
        ).rejects.toBeInstanceOf(Error);
        expect(socket.connected).toBe(false);
      } finally {
        socket.disconnect();
      }
    },
  );

  it('crea una partida, incorpora tres alumnos, responde, guarda y finaliza a través del proxy', async () => {
    const sockets: Client[] = [];
    try {
      const teacher = await client('websocket');
      sockets.push(teacher);
      const created = nextEvent(teacher, 'session:created');
      teacher.emit('teacher:create-session', {
        workbookReference: 'Quiz/proxy.xlsx',
      });
      const session = await created;
      for (const [index, nick] of ['Ana', 'Luis', 'María'].entries()) {
        const student = await client(index === 0 ? 'polling' : 'websocket');
        sockets.push(student);
        const joined = nextEvent(student, 'student:joined');
        student.emit('student:join', { joinCode: session.joinCode, nick });
        expect((await joined).nick).toBe(nick);
      }
      const controls = {
        sessionId: session.sessionId,
        teacherToken: session.teacherToken,
      };
      const students = sockets.slice(1);
      const questions = students.map((socket) =>
        nextEvent(socket, 'question:started'),
      );
      teacher.emit('teacher:start-game', controls);
      const started = await Promise.all(questions);
      expect(started[1]).toEqual(started[0]);
      expect(started[2]).toEqual(started[0]);
      for (const [index, student] of students.entries()) {
        const question = started[index]!;
        const accepted = nextEvent(student, 'answer:accepted');
        student.emit('student:answer', {
          questionId: question.questionId,
          answerOptionId: question.options.find((option) => option.text === '4')!
            .id,
        });
        await accepted;
      }
      const ranking = nextEvent(teacher, 'ranking:updated');
      const saved = nextEvent(
        teacher,
        'workbook:save-updated',
        (payload) => payload.status === 'saved',
      );
      teacher.emit('teacher:close-question', controls);
      expect(await ranking).toHaveLength(3);
      expect(await saved).toMatchObject({ worksheetName: 'P01', status: 'saved' });
      const finished = students.map((socket) => nextEvent(socket, 'game:ended'));
      teacher.emit('teacher:end-game', controls);
      for (const result of await Promise.all(finished)) {
        expect(result.podium).toHaveLength(3);
      }
    } finally {
      for (const socket of sockets) socket.disconnect();
    }
  });
});
