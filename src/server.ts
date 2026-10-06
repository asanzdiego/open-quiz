import { createApplication } from './app.ts';
import { readConfig } from './config/env.ts';

function startServer() {
  const config = readConfig();
  const { httpServer, io } = createApplication({ config });

  httpServer.once('error', () => {
    console.error(
      JSON.stringify({
        event: 'server_start_failed',
        message: 'No se ha podido iniciar el servidor. Comprueba el puerto.',
      }),
    );
    process.exitCode = 1;
    io.close();
  });

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.info(
      JSON.stringify({
        event: 'server_started',
        host: '0.0.0.0',
        port: config.port,
        environment: config.nodeEnv,
      }),
    );
  });

  const stopServer = () => {
    io.close();
  };

  process.once('SIGINT', stopServer);
  process.once('SIGTERM', stopServer);
}

try {
  startServer();
} catch {
  console.error(
    JSON.stringify({
      event: 'server_config_invalid',
      message:
        'Configuración inválida: revisa PORT, NODE_ENV, los TTL y las variables NEXTCLOUD_* del servidor.',
    }),
  );
  process.exitCode = 1;
}
