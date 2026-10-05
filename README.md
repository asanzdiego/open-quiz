# Open Quiz

Aplicación educativa de cuestionarios en tiempo real, con frontend sencillo y sin cuentas ni base de datos.

**Estado actual: Fases 1 y 2 terminadas.** Esta versión sirve una página inicial, permite comprobar la conexión con Socket.IO y ofrece `GET /health`. Incluye el dominio de sesiones y participantes en memoria y la función de puntuación, probados de forma independiente. La creación de partidas desde el navegador se implementará en la Fase 5.

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

`npm run format:check` comprueba el formato sin modificar archivos y `npm run test:watch` ejecuta las pruebas al editar. Las pruebas cubren la configuración, `/health`, el frontend estático, la conexión real de Socket.IO mediante polling y WebSocket, y el dominio de sesiones, participantes y puntuación. No requieren Nextcloud ni servicios externos.

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

Las variables reservadas figuran en `.env.example`, pero todavía no se leen ni validan. En esta fase, los puntos máximos y los TTL se configuran mediante argumentos del dominio; se conectarán a las variables de entorno al integrar el flujo real. La conexión con Nextcloud se configurará al implementar su adaptador.

## Dominio de sesiones y participantes

`SessionService` trabaja con `InMemorySessionRepository`, sin depender de Express, Socket.IO ni almacenamiento externo. Cada servicio crea su propio repositorio salvo que se le proporcione uno. El repositorio utiliza índices por ID y código; el servicio devuelve copias para que quien lo llama no pueda modificar su estado interno.

- Los identificadores de sesión y participante son UUID generados en el servidor.
- Los códigos tienen seis caracteres, excluyen `0`, `1`, `I` y `O`, y se regeneran si colisionan. Tras 100 intentos se devuelve un error seguro.
- Los tokens de profesor y reconexión contienen 32 bytes aleatorios, codificados en base64url. El código de partida no autoriza al profesor.
- Los modelos completos contienen secretos y son exclusivos del backend. No deben emitirse directamente por Socket.IO ni registrarse en logs.
- El nick se recorta y normaliza a Unicode NFC, admite hasta 24 caracteres Unicode y rechaza caracteres de control. No puede repetirse ignorando mayúsculas, incluso si el participante está desconectado. Se conserva como texto; al incorporarlo a una interfaz debe usarse `textContent`.
- Solo se admiten nuevos participantes en `LOBBY`. Un participante existente puede reconectar con código, ID y token en cualquiera de los estados mientras la sesión siga en memoria, conservando sus puntos. Una desconexión tardía del socket anterior se ignora.

Las transiciones autorizadas mediante el token del profesor son:

```text
LOBBY → QUESTION_ACTIVE → QUESTION_RESULTS → QUESTION_ACTIVE
LOBBY → FINISHED
QUESTION_RESULTS → FINISHED
```

Una partida terminada no se reabre. Para terminar desde una pregunta activa, primero debe pasarse por los resultados. Estas transiciones solo controlan el estado: el inicio de preguntas, el temporizador, las respuestas y el ranking corresponden a la Fase 6.

`cleanupExpired({ sessionTtlMs, finishedSessionTtlMs })` elimina sesiones sin actividad al alcanzar el primer TTL y sesiones terminadas al alcanzar el segundo, medido desde `finishedAt`. Elimina también el índice de código. Ambos límites son enteros positivos en milisegundos. La limpieza se invoca explícitamente; todavía no hay un temporizador de limpieza conectado al servidor web.

`calculatePoints({ isCorrect, elapsedMs, durationMs, maxPoints })` aplica la fórmula lineal, redondea a entero y limita el resultado a `[0, maxPoints]`. El máximo predeterminado es 1000. Una respuesta incorrecta o recibida al alcanzar o superar la duración obtiene cero puntos. Los tiempos negativos se limitan a cero; las duraciones no positivas, los números no finitos y los máximos inválidos generan un error. Los tiempos del dominio se expresan en milisegundos y, al integrar el juego, procederán del reloj del servidor.

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
  domain/
    identifiers.ts  Generación criptográfica de códigos y tokens
    errors.ts       Errores de dominio con código y mensaje comprensible
    participant/    Modelo y normalización del nick
    session/        Modelo, transiciones y repositorio en memoria
    scoring/        Función de puntuación lineal
  services/
    session-service.ts  Creación, participantes, reconexión y limpieza
public/
  index.html        Página inicial
  css/styles.css    Estilos responsive
  js/main.js        Estado de conexión de Socket.IO
tests/
  app.test.ts       Pruebas HTTP y conexión en tiempo real
  config.test.ts    Pruebas de configuración
  identifiers.test.ts        Formato de códigos y secretos
  session-repository.test.ts Índices, colisiones y eliminación
  session-service.test.ts    Sesiones, participantes, estados, reconexión y TTL
  scoring.test.ts            Límites y fórmula de puntuación
```

La factoría `createApplication()` permite probar la aplicación sin arrancar el proceso de producción. TypeScript se ejecuta con Node.js en desarrollo y se compila a `dist/` para `npm start`. Express y Socket.IO son las únicas dependencias de ejecución; las herramientas de calidad y los clientes de prueba son dependencias de desarrollo.

Se conservan las instrucciones en `AGENTS.md` y la licencia original en `LICENSE`.
