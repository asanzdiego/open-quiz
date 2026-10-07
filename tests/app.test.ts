import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/app.ts';
import { readConfig } from '../src/config/env.ts';

describe('Servidor HTTP y Socket.IO', () => {
  const { httpServer, io } = createApplication();
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
    });

    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  it('GET /health devuelve únicamente el estado del servicio', async () => {
    const response = await request(httpServer)
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('sirve la página inicial en español', async () => {
    const response = await request(httpServer)
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(response.text).toContain('<html lang="es">');
    expect(response.text).toContain('<h1>Open Quiz</h1>');
  });

  it.each([
    ['/css/styles.css', /css/],
    ['/js/main.js', /javascript/],
    ['/teacher.html', /html/],
    ['/student.html', /html/],
    ['/js/teacher.js', /javascript/],
    ['/js/student.js', /javascript/],
    ['/js/lobby.js', /javascript/],
    ['/js/game.js', /javascript/],
    ['/js/ui.js', /javascript/],
    ['/socket.io/socket.io.js', /javascript/],
  ])('sirve el recurso %s', async (path, contentType) => {
    await request(httpServer)
      .get(path)
      .expect(200)
      .expect('Content-Type', contentType);
  });

  it('devuelve un error comprensible para una ruta inexistente', async () => {
    const response = await request(httpServer).get('/inexistente').expect(404);

    expect(response.body).toEqual({ error: 'Recurso no encontrado.' });
  });

  it.each(['polling', 'websocket'])(
    'conecta Socket.IO mediante %s',
    async (transport) => {
      const client = connect(baseUrl, {
        transports: [transport],
        autoConnect: false,
        reconnection: false,
        timeout: 2000,
      });

      try {
        await new Promise<void>((resolve, reject) => {
          client.once('connect', resolve);
          client.once('connect_error', reject);
          client.connect();
        });

        expect(client.connected).toBe(true);
      } finally {
        client.disconnect();
      }
    },
  );

  it.each([
    '/',
    '/teacher.html',
    '/student.html',
    '/health',
    '/inexistente',
    '/socket.io/socket.io.js',
  ])('aplica cabeceras de protección a %s', async (path) => {
    const response = await request(httpServer).get(path);
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(response.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers['content-security-policy']).not.toContain(
      'unsafe-inline',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('acepta únicamente PUBLIC_ORIGIN y limita conexiones simultáneas', async () => {
    const isolated = createApplication({
      config: readConfig({
        PUBLIC_ORIGIN: 'https://quiz.example.com',
        MAX_CONNECTIONS: '1',
      }),
    });
    await new Promise<void>((resolve) =>
      isolated.httpServer.listen(0, '127.0.0.1', resolve),
    );
    const url = `http://127.0.0.1:${(isolated.httpServer.address() as AddressInfo).port}`;
    const connectClient = (origin: string) =>
      connect(url, {
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
        extraHeaders: { Origin: origin },
      });
    const foreign = connectClient('https://otro.example.com');
    const accepted = connectClient('https://quiz.example.com');
    const overflow = connectClient('https://quiz.example.com');
    function connection(socket: ReturnType<typeof connect>) {
      return new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
    }
    try {
      await expect(connection(foreign)).rejects.toBeInstanceOf(Error);
      await connection(accepted);
      await expect(connection(overflow)).rejects.toBeInstanceOf(Error);
      expect(accepted.connected).toBe(true);
    } finally {
      for (const socket of [foreign, accepted, overflow]) socket.disconnect();
      await new Promise<void>((resolve) => isolated.io.close(() => resolve()));
    }
  });

  it.each(['polling', 'websocket'])(
    'cierra una conexión con payload excesivo mediante %s',
    async (transport) => {
      const client = connect(baseUrl, {
        autoConnect: false,
        reconnection: false,
        transports: [transport],
      });
      try {
        await new Promise<void>((resolve, reject) => {
          client.once('connect', resolve);
          client.once('connect_error', reject);
          client.connect();
        });
        const disconnected = new Promise<void>((resolve) =>
          client.once('disconnect', () => resolve()),
        );
        client.emit('student:join', {
          joinCode: 'ABC234',
          nick: 'x'.repeat(17 * 1024),
        });
        await disconnected;
        expect(client.connected).toBe(false);
        await request(httpServer).get('/health').expect(200);
      } finally {
        client.disconnect();
      }
    },
  );

  it.each(['polling', 'websocket'])(
    'rechaza un origen externo mediante %s',
    async (transport) => {
      const client = connect(baseUrl, {
        transports: [transport],
        autoConnect: false,
        reconnection: false,
        extraHeaders: { Origin: 'https://otro.example.com' },
        timeout: 2000,
      });
      try {
        const connection = new Promise<void>((resolve, reject) => {
          client.once('connect', resolve);
          client.once('connect_error', reject);
          client.connect();
        });
        await expect(connection).rejects.toBeInstanceOf(Error);
        expect(client.connected).toBe(false);
      } finally {
        client.disconnect();
      }
    },
  );
});
