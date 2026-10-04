# Open Quiz

Aplicación educativa de cuestionarios en tiempo real, con frontend sencillo y sin cuentas ni base de datos.

**Estado actual: Fase 1 terminada.** Esta versión sirve una página inicial, permite comprobar la conexión con Socket.IO y ofrece `GET /health`. El flujo de partidas se implementará en las siguientes fases descritas en `AGENTS.md`.

## Requisitos e instalación

- [Node.js 24 LTS](https://nodejs.org/en/download) y npm.
- Si utilizas nvm, ejecuta `nvm install` y `nvm use` para leer `.nvmrc`.

```sh
npm install
cp .env.example .env
npm run dev
```

Abre <http://localhost:3000>. El proceso escucha en `0.0.0.0` y utiliza `PORT`, por lo que también puedes acceder desde otro dispositivo de la misma red si el firewall lo permite. El modo de desarrollo reinicia el servidor cuando cambia el código TypeScript.

Copiar `.env` es opcional: sin ese archivo se utilizan los valores predeterminados. Node.js carga el archivo mediante `--env-file-if-exists`; las variables del entorno del proceso tienen prioridad. `.env` queda excluido de Git.

## Comprobaciones

```sh
npm run format
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run format:check` comprueba el formato sin modificar archivos y `npm run test:watch` ejecuta las pruebas al editar. Las pruebas cubren la configuración, `/health`, el frontend estático y la conexión real de Socket.IO mediante polling y WebSocket. No requieren Nextcloud ni servicios externos.

Para ejecutar el código compilado:

```sh
npm run build
npm start
```

El frontend sigue sirviéndose desde `public/`. Para detener el servidor utiliza `Ctrl+C`; también admite `SIGTERM`.

## Variables de entorno

| Variable                            | Valor predeterminado | Uso actual                           |
| ----------------------------------- | -------------------- | ------------------------------------ |
| `PORT`                              | `3000`               | Puerto HTTP, entero entre 1 y 65535  |
| `NODE_ENV`                          | `development`        | `development`, `test` o `production` |
| `DEFAULT_QUESTION_DURATION_SECONDS` | `20`                 | Reservada para fases posteriores     |
| `MAX_POINTS_PER_QUESTION`           | `1000`               | Reservada para fases posteriores     |
| `SESSION_TTL_MINUTES`               | `120`                | Reservada para fases posteriores     |
| `FINISHED_SESSION_TTL_MINUTES`      | `30`                 | Reservada para fases posteriores     |

Las variables reservadas figuran en `.env.example`, pero todavía no se leen ni validan. La conexión con Nextcloud se configurará al implementar su adaptador.

## HTTP y conexión en tiempo real

- `GET /`: página inicial con el estado de conexión.
- `GET /health`: responde exactamente con `{"status":"ok"}`.
- `/socket.io/`: transporte Socket.IO y cliente JavaScript servido desde la propia aplicación.

Solo se utilizan los eventos de conexión incorporados de Socket.IO. Los eventos del juego se definirán en las fases correspondientes. No se habilita CORS para otros orígenes.

## Uso por profesor y alumnos

Esta fase permite abrir la página y comprobar que el servidor responde. La creación de partidas, los códigos de acceso y la entrada con nick están pendientes de la Fase 5; la mecánica de preguntas está prevista para la Fase 6.

## Formato del Excel previsto

La lectura de `.xlsx` se implementará en la Fase 3. El formato previsto es una pregunta por fila con cinco columnas:

| A        | B                  | C                      | D                      | E                      |
| -------- | ------------------ | ---------------------- | ---------------------- | ---------------------- |
| Pregunta | Respuesta correcta | Respuesta incorrecta 1 | Respuesta incorrecta 2 | Respuesta incorrecta 3 |

La primera fila podrá contener una cabecera. La escritura de resultados en las pestañas `P01`, `P02`, etc. corresponde a la Fase 7.

## Docker

El Dockerfile y las instrucciones de despliegue están previstos para la Fase 9. Por ahora se ejecuta directamente con Node.js.

## Arquitectura actual

```text
src/
  app.ts            Express, archivos estáticos y Socket.IO sobre un servidor HTTP
  server.ts         Arranque, logs de inicio y cierre del servidor
  config/env.ts     Lectura y validación de PORT y NODE_ENV
public/
  index.html        Página inicial
  css/styles.css    Estilos responsive
  js/main.js        Estado de conexión de Socket.IO
tests/
  app.test.ts       Pruebas HTTP y conexión en tiempo real
  config.test.ts    Pruebas de configuración
```

La factoría `createApplication()` permite probar la aplicación sin arrancar el proceso de producción. TypeScript se ejecuta con Node.js en desarrollo y se compila a `dist/` para `npm start`. Express y Socket.IO son las únicas dependencias de ejecución; las herramientas de calidad y los clientes de prueba son dependencias de desarrollo.

Se conservan las instrucciones en `AGENTS.md` y la licencia original en `LICENSE`.
