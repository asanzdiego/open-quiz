import { request, type IncomingMessage } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';

/** Termina TLS y reenvía HTTP y Upgrade conservando el Host público. */
export async function createHttpsReverseProxy(
  upstreamPort: number,
  tls: { key: string; cert: string },
) {
  const connections = new Set<Socket>();
  const upstreamHeaders = (incoming: IncomingMessage) => ({
    ...incoming.headers,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': incoming.headers.host ?? '',
    'x-forwarded-for': incoming.socket.remoteAddress ?? '',
  });
  const options = (incoming: IncomingMessage) => ({
    hostname: '127.0.0.1',
    port: upstreamPort,
    path: incoming.url,
    method: incoming.method,
    headers: upstreamHeaders(incoming),
  });

  const proxy = createServer(tls, (incoming, outgoing) => {
    const upstream = request(options(incoming), (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
      response.on('error', () => outgoing.destroy());
    });
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('error', () => upstream.destroy());
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });

  proxy.on('upgrade', (incoming, downstream, head) => {
    const upstream = request(options(incoming));
    upstream.on('upgrade', (response, socket, upstreamHead) => {
      const headers = response.rawHeaders.reduce<string[]>(
        (lines, value, index, raw) => {
          if (index % 2 === 0) lines.push(`${value}: ${raw[index + 1]}`);
          return lines;
        },
        [],
      );
      downstream.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${headers.join('\r\n')}\r\n\r\n`,
      );
      if (head.length) socket.write(head);
      if (upstreamHead.length) downstream.write(upstreamHead);
      socket.pipe(downstream);
      downstream.pipe(socket);
      socket.on('error', () => downstream.destroy());
      downstream.on('error', () => socket.destroy());
      downstream.on('close', () => socket.destroy());
      socket.on('close', () => downstream.destroy());
    });
    upstream.on('response', (response) => {
      response.resume();
      downstream.end(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    });
    upstream.on('error', () => downstream.destroy());
    downstream.on('error', () => upstream.destroy());
    downstream.on('close', () => upstream.destroy());
    upstream.end();
  });

  proxy.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', () => {
      proxy.removeListener('error', reject);
      resolve();
    });
  });

  return {
    url: `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        proxy.close((error) => (error ? reject(error) : resolve()));
        for (const socket of connections) socket.destroy();
      }),
  };
}
