# Open Quiz

Aplicación educativa de cuestionarios en tiempo real, con frontend sencillo y sin cuentas ni base de datos.

**Estado actual: Fases 1–5 terminadas.** El profesor puede crear una partida indicando un XLSX de Nextcloud; el backend lo descarga y valida, crea la sesión en memoria y muestra un código. Los alumnos entran con código y nick y el lobby se actualiza en tiempo real. Profesor y alumnos pueden recuperar su conexión. El inicio de preguntas corresponde a la Fase 6; el botón `Iniciar` permanece deshabilitado.

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

`npm run format:check` comprueba el formato sin modificar archivos y `npm run test:watch` ejecuta las pruebas al editar. Las pruebas cubren la configuración, `/health`, el frontend estático, Socket.IO mediante polling y WebSocket, el dominio y la importación de XLSX. El flujo del lobby usa almacenamiento simulado y clientes Socket.IO reales: creación, tres alumnos, nicks duplicados, desconexión, recuperación con tokens, conservación de puntos, aislamiento de rooms, validación, errores y límites de intentos. También prueban WebDAV con un cliente simulado y con el cliente real contra un servidor HTTP local. Los fixtures de Excel están en `tests/fixtures/excel/` y pueden regenerarse con `npm run fixtures:excel`. Las pruebas no requieren Nextcloud ni servicios externos; necesitan poder abrir puertos locales.

Para ejecutar el código compilado:

```sh
npm run build
npm start
```

El frontend sigue sirviéndose desde `public/`. Para detener el servidor utiliza `Ctrl+C`; también admite `SIGTERM`.

## Variables de entorno

| Variable                            | Valor predeterminado | Uso actual                                             |
| ----------------------------------- | -------------------- | ------------------------------------------------------ |
| `PORT`                              | `3000`               | Puerto HTTP, entero entre 1 y 65535                    |
| `NODE_ENV`                          | `development`        | `development`, `test` o `production`                   |
| `NEXTCLOUD_WEBDAV_URL`              | Sin configurar       | Raíz WebDAV de la cuenta de Nextcloud                  |
| `NEXTCLOUD_USERNAME`                | Sin configurar       | Usuario de Nextcloud; solo backend                     |
| `NEXTCLOUD_APP_PASSWORD`            | Sin configurar       | Contraseña de aplicación; solo backend                 |
| `NEXTCLOUD_REQUEST_TIMEOUT_MS`      | `15000`              | Tiempo máximo por descarga/subida, entre 1 y 300000 ms |
| `DEFAULT_QUESTION_DURATION_SECONDS` | `20`                 | Reservada para fases posteriores                       |
| `MAX_POINTS_PER_QUESTION`           | `1000`               | Reservada para fases posteriores                       |
| `SESSION_TTL_MINUTES`               | `120`                | Minutos sin actividad antes de eliminar una sesión     |
| `FINISHED_SESSION_TTL_MINUTES`      | `30`                 | Minutos desde la finalización para eliminar una sesión |

Las variables de tiempo de pregunta y puntos máximos todavía no se leen ni validan; se conectarán al juego en la Fase 6. Los TTL son enteros positivos y se comprueban cada minuto. La actividad incluye creación, entrada, reconexión y desconexión; mantener una página abierta sin interactuar no renueva el TTL.

El servidor arranca con las tres variables de Nextcloud ausentes o vacías; en ese caso, crear una partida devuelve un error comprensible. Si configuras alguna, debes completar las tres; una configuración parcial o inválida impide arrancar. El timeout se valida al configurar la conexión. Ni la configuración ni las credenciales se envían al navegador o se registran en logs. La descarga se realiza al crear la partida, no al arrancar el servidor.

## Adaptador Nextcloud/WebDAV

El modo inicial utiliza usuario y contraseña de aplicación mediante autenticación básica sobre HTTPS. Obtén la contraseña en los ajustes personales de Nextcloud, sección Seguridad, y copia la URL WebDAV de la sección de archivos, por ejemplo `https://cloud.example.com/remote.php/dav/files/docente/`. Si Nextcloud está instalado en un subdirectorio, inclúyelo en la URL. Consulta el [manual oficial de acceso WebDAV](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html).

Configura `NEXTCLOUD_WEBDAV_URL`, `NEXTCLOUD_USERNAME` y `NEXTCLOUD_APP_PASSWORD` en el `.env` del servidor o en las variables de entorno del hosting. La URL no debe contener usuario/contraseña, parámetros ni fragmentos. HTTP se admite únicamente en `localhost`, `127.0.0.1` y `::1` para pruebas locales. Los enlaces compartidos quedan para una ampliación del adaptador; esta fase implementa un solo modo de conexión.

`WorkbookStorage` define el contrato `downloadWorkbook(reference): Promise<Buffer>` y `uploadWorkbook(reference, data): Promise<void>`. `NextcloudWebDavWorkbookStorage` lo implementa mediante el cliente mantenido [`webdav`](https://github.com/perry-mitchell/webdav-client). La referencia es una ruta literal relativa a la raíz configurada, por ejemplo `Quiz/Matemáticas 1.xlsx`, con barra inicial opcional; no es una URL pública ni una ruta del disco local. Escribe espacios, tildes y otros caracteres tal como aparecen en Nextcloud, sin codificarlos como URL. Solo se admite extensión `.xlsx`, sin distinguir mayúsculas. Se rechazan rutas vacías, segmentos `.` o `..`, barras duplicadas, barras invertidas, dos puntos, caracteres de control y rutas de más de 1024 caracteres.

Cada descarga obtiene el contenido remoto actual y devuelve un `Buffer`; no se usa disco ni una copia persistente. La subida recibe un `Buffer` no vacío y **sustituye el contenido del fichero indicado**, con el tipo MIME de XLSX. No crea carpetas ni modifica hojas de Excel; la validación del contenido sigue correspondiendo a `importQuestions`. La escritura de pestañas de resultados, el lock por sesión y los reintentos del profesor se implementarán en la Fase 7.

`WorkbookStorageError` proporciona códigos y mensajes comprensibles para autenticación, permisos, fichero inexistente, carpeta inexistente, bloqueo, cuota, timeout y fallos generales de lectura/escritura. No conserva la respuesta ni el error original del cliente WebDAV, que pueden contener información sensible. No hay reintentos automáticos de subida. Para las pruebas de servicios, `tests/helpers/in-memory-workbook-storage.ts` ofrece un mock intercambiable que copia los Buffers y aísla los libros.

### Prueba manual con Nextcloud

1. Crea una carpeta de prueba en Nextcloud y sube un libro válido, por ejemplo `Quiz/prueba.xlsx`, con las cinco columnas descritas más abajo. Puedes usar `tests/fixtures/excel/valid-header.xlsx`. El usuario configurado debe tener permiso de lectura y escritura.
2. Rellena las tres variables de conexión en `.env` y ejecuta la prueba de descarga e importación:

   ```sh
   npm run check:nextcloud -- "Quiz/prueba.xlsx"
   ```

   Debe aparecer `nextcloud_download_verified` con el número de preguntas. Este comando solo lee el fichero.

3. Para comprobar también la subida, utiliza ese libro de prueba sin editores abiertos:

   ```sh
   npm run check:nextcloud -- "Quiz/prueba.xlsx" --write-back
   ```

   El comando sube exactamente los bytes descargados, vuelve a descargar y compara el contenido. Debe aparecer también `nextcloud_upload_verified`. La opción `--write-back` sustituye el fichero de prueba por la copia que acaba de descargar; no añade pestañas ni resultados.

4. Comprueba los errores indicando una ruta inexistente o usando temporalmente una contraseña de aplicación inválida. El comando debe devolver un mensaje comprensible y terminar con código 1, sin mostrar credenciales ni la URL configurada. Con un usuario sin permiso de escritura, la prueba de lectura puede funcionar y la de subida debe fallar de forma segura.

La verificación automática utiliza únicamente servidores locales y mocks. La prueba con una instancia real de Nextcloud requiere su configuración y se realiza con el comando anterior.

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

`cleanupExpired({ sessionTtlMs, finishedSessionTtlMs })` elimina sesiones sin actividad al alcanzar el primer TTL y sesiones terminadas al alcanzar el segundo, medido desde `finishedAt`. Elimina también el índice de código. Ambos límites son enteros positivos en milisegundos. La aplicación lo invoca cada minuto y cancela el temporizador al cerrar el servidor. La sesión conserva la referencia del libro y las preguntas importadas, nunca una copia del XLSX como fuente de verdad para futuras escrituras.

`calculatePoints({ isCorrect, elapsedMs, durationMs, maxPoints })` aplica la fórmula lineal, redondea a entero y limita el resultado a `[0, maxPoints]`. El máximo predeterminado es 1000. Una respuesta incorrecta o recibida al alcanzar o superar la duración obtiene cero puntos. Los tiempos negativos se limitan a cero; las duraciones no positivas, los números no finitos y los máximos inválidos generan un error. Los tiempos del dominio se expresan en milisegundos y, al integrar el juego, procederán del reloj del servidor.

## HTTP y conexión en tiempo real

- `GET /`: página inicial con accesos de profesor y alumno y estado de conexión.
- `GET /teacher.html`: creación de partida y sala del profesor.
- `GET /student.html`: entrada y sala del alumno; acepta `?code=XF82KP` para rellenar el código.
- `GET /health`: responde exactamente con `{"status":"ok"}`.
- `/socket.io/`: transporte Socket.IO y cliente JavaScript servido desde la propia aplicación.

Los eventos están tipados en `src/realtime/events.ts`. Todos los payloads entrantes se validan en el servidor, incluidos campos inesperados. Cada conexión pertenece a una sola sesión y rol. Los errores se envían solo al solicitante mediante `app:error`, con `{ operation, code, message }`.

| Cliente → servidor       | Payload                                       | Respuesta privada  |
| ------------------------ | --------------------------------------------- | ------------------ |
| `teacher:create-session` | `{ workbookReference }`                       | `session:created`  |
| `teacher:reconnect`      | `{ sessionId, teacherToken }`                 | `session:restored` |
| `student:join`           | `{ joinCode, nick }`                          | `student:joined`   |
| `student:reconnect`      | `{ joinCode, participantId, reconnectToken }` | `student:restored` |

Las respuestas del profesor contienen `{ sessionId, joinCode, teacherToken, lobby }`; las del alumno contienen `{ joinCode, participantId, reconnectToken, nick, totalPoints, lobby }`. Solo se envían al socket propietario. `lobby:updated` se publica en la room de esa sesión al entrar, desconectar o reconectar un alumno. Su payload es `{ joinCode, state, questionCount, participants }`, con participantes `{ id, nick, connected, totalPoints }`. No incluye preguntas, respuestas correctas, tokens, rutas ni IDs de socket.

No se habilita CORS para otros orígenes. El handshake rechaza un `Origin` cuyo host no coincida con el servidor, también para WebSocket; los clientes de pruebas sin `Origin` pueden conectar. El límite de payload es 16 KiB. Se admiten inicialmente 120 operaciones y cinco intentos de creación por minuto e IP vista por el servidor, compartidos entre sockets. No se confía en `X-Forwarded-For`; detrás de un proxy varios usuarios pueden compartir esos límites. Los logs incluyen eventos e identificadores internos, sin tokens, credenciales, referencias ni detalles de errores inesperados.

## Uso por profesor y alumnos

1. Configura Nextcloud en el backend y ejecuta `npm run dev`.
2. El profesor pulsa **Crear partida** e indica una ruta como `Quiz/Matemáticas.xlsx`. Se utiliza la primera hoja y la detección automática de cabecera. Un error de descarga o formato impide crear la sesión y se muestra en el formulario.
3. La sala muestra el código de seis caracteres, el enlace para alumnos, el número de preguntas y los participantes conectados o desconectados. Comparte el enlace desde una dirección accesible para sus dispositivos; `localhost` solo funciona en el dispositivo del profesor.
4. Cada alumno pulsa **Entrar como alumno**, introduce código y nick y permanece esperando al profesor. Los cambios de participantes se muestran a todos los miembros de esa sala.

El token del profesor se guarda en `sessionStorage`: permite recuperar la sala al recargar la misma pestaña o tras una interrupción de red. Al cerrar la pestaña se pierde esa recuperación. El alumno guarda código, ID y token en `localStorage`, por lo que recupera su participante al recargar o reabrir la página en el mismo navegador. No se recupera por nick ni se crea un participante nuevo automáticamente al reconectar. Una conexión nueva autorizada sustituye la anterior para evitar dos sockets activos con la misma identidad. Se mantiene una participación de alumno por navegador y origen; usa dispositivos o perfiles separados para simular varios alumnos.

Si la sesión ya no existe o el token no es válido, se borra la recuperación guardada y se vuelve al formulario con el error. Si falla temporalmente, se ofrece reintentar. Un navegador que bloquee el almacenamiento puede utilizar la sala mientras conserve la página abierta, pero no recuperarla tras recargar. Reiniciar el servidor elimina todas las partidas en memoria.

### Prueba manual del lobby

Con un XLSX válido en Nextcloud y el backend configurado, crea una partida y entra con tres dispositivos o perfiles de navegador distintos. Comprueba que el profesor recibe los tres nicks y que un nick repetido se rechaza. Recarga una página de alumno: debe recuperar el mismo nick sin duplicarlo. Desconecta su red y restáurala: su estado debe volver a conectado. Recarga la pestaña del profesor y comprueba que conserva código y participantes. Crea una segunda partida en otra pestaña independiente y comprueba que sus participantes no aparecen en la primera.

El juego, las respuestas y la escritura de resultados quedan pendientes de las Fases 6 y 7. La creación del lobby únicamente descarga el libro; no lo modifica.

## Formato del Excel e importación

Solo se admite `.xlsx`. Cada fila con contenido representa una pregunta con cinco columnas:

| A        | B                  | C                      | D                      | E                      |
| -------- | ------------------ | ---------------------- | ---------------------- | ---------------------- |
| Pregunta | Respuesta correcta | Respuesta incorrecta 1 | Respuesta incorrecta 2 | Respuesta incorrecta 3 |

La primera fila con contenido puede ser una cabecera con los cinco títulos anteriores. La detección automática ignora mayúsculas y espacios adicionales. Si solo coinciden algunos títulos, la importación falla con un error de cabecera ambigua; no se descarta silenciosamente una posible pregunta. Las cabeceras repetidas entre preguntas también se rechazan.

`importQuestions(buffer, options)` lee el libro en memoria mediante ExcelJS y devuelve `{ worksheetName, hasHeader, questions }`. Selecciona la primera hoja del libro por defecto. Para utilizar la hoja `Preguntas`, indica `{ worksheetName: 'Preguntas' }`; si no existe, devuelve un error. No busca otra hoja si la seleccionada está vacía o es inválida.

`headerMode` admite `auto` (predeterminado), `present` y `absent`. `present` confirma explícitamente que la primera fila con contenido es una cabecera personalizada con cinco celdas no vacías. `absent` confirma que esa fila es una pregunta, incluso si su texto se parece a una cabecera.

- Se recorta y normaliza a Unicode NFC el texto. Se admiten texto, texto con formato y números finitos, convertidos a texto; el cero es una respuesta válida. Para conservar ceros iniciales o formatos como `01`, escribe la celda como texto.
- Cada pregunta requiere un enunciado, una respuesta correcta y tres incorrectas no vacías. Las cuatro respuestas deben ser distintas tras la normalización; se distinguen mayúsculas y minúsculas.
- Se ignoran filas completamente vacías y celdas vacías con solo formato. Los datos fuera de A–E se rechazan para no descartar respuestas adicionales.
- Se rechazan fórmulas, incluidas las que tienen un resultado almacenado, fechas, valores lógicos, hipervínculos, errores de Excel, celdas combinadas en los datos e imágenes en la hoja seleccionada. Utiliza valores literales como texto para fechas o respuestas como `Sí` y `No`.
- Se mantiene el orden de las preguntas y de las tres respuestas incorrectas. Cada pregunta recibe un UUID y contiene `text`, `correctAnswer` e `incorrectAnswers`. Este modelo es exclusivo del backend: incluye la respuesta correcta y no debe enviarse directamente durante una pregunta activa. El barajado se implementará en la Fase 6.
- Un libro inválido o una fila inválida rechaza toda la importación. `ExcelImportError` proporciona un código, un mensaje comprensible y, cuando corresponde, el nombre de hoja y la dirección de celda, sin incluir su contenido en el error.

El importador no lee archivos locales ni modifica el `Buffer`. Los archivos locales solo se utilizan en las pruebas. El adaptador WebDAV obtiene los libros desde Nextcloud; la escritura de resultados en las pestañas `P01`, `P02`, etc. corresponde a la Fase 7.

## Docker

El Dockerfile y las instrucciones de despliegue están previstos para la Fase 9. Por ahora se ejecuta directamente con Node.js.

## Arquitectura actual

```text
src/
  app.ts            Express, Socket.IO, servicios inyectables y limpieza periódica
  server.ts         Arranque, logs de inicio y cierre del servidor
  config/
    env.ts          Lectura y validación de la configuración de la aplicación
    nextcloud.ts    Configuración opcional de WebDAV y validación sin secretos en errores
  domain/
    identifiers.ts  Generación criptográfica de códigos y tokens
    errors.ts       Errores de dominio con código y mensaje comprensible
    participant/    Modelo y normalización del nick
    session/        Modelo, transiciones y repositorio en memoria
                    Vista pública del lobby sin secretos
    scoring/        Función de puntuación lineal
    question/       Modelo de pregunta importada, exclusivo del backend
  excel/
    import-questions.ts    Lectura y validación XLSX desde Buffer
    excel-import-error.ts  Errores de importación con hoja y celda
  services/
    session-service.ts  Creación, participantes, reconexión y limpieza
    load-session-workbook.ts   Descarga y validación antes de crear la sesión
    workbook-reference.ts      Validación compartida de rutas relativas XLSX
    workbook-storage.ts        Contrato de descarga/subida en memoria
    workbook-storage-error.ts  Errores seguros de almacenamiento
  nextcloud/
    nextcloud-webdav-workbook-storage.ts  Implementación WebDAV autenticada
  realtime/
    events.ts         Tipos de eventos, payloads y pertenencia del socket
    payloads.ts       Validación de todos los payloads del lobby
    lobby-handlers.ts Adaptación del flujo a Socket.IO y rooms aisladas
    rate-limiter.ts   Límite de intentos por IP sin dependencias adicionales
scripts/
  check-nextcloud.ts Prueba manual de descarga/importación y subida opcional
public/
  index.html        Página inicial
  teacher.html      Formulario de creación y sala del profesor
  student.html      Entrada y espera del alumno
  css/styles.css    Estilos responsive
  js/main.js        Estado de conexión de Socket.IO
  js/lobby.js       Conexión, recuperación y lista de participantes compartidas
  js/teacher.js     Creación y código de la sala
  js/student.js     Entrada y nick recuperado
tests/
  app.test.ts       Pruebas HTTP y conexión en tiempo real
  lobby-integration.test.ts   Flujo real del lobby con almacenamiento simulado
  config.test.ts    Pruebas de configuración
  identifiers.test.ts        Formato de códigos y secretos
  session-repository.test.ts Índices, colisiones y eliminación
  session-service.test.ts    Sesiones, participantes, estados, reconexión y TTL
  scoring.test.ts            Límites y fórmula de puntuación
  excel-import.test.ts       Lectura real de XLSX, cabeceras y filas inválidas
  fixtures/excel/            Libros de prueba y generador reproducible
  nextcloud-config.test.ts              Validación de conexión y credenciales
  nextcloud-storage.test.ts             Adaptador con cliente simulado
  nextcloud-storage-integration.test.ts Cliente WebDAV y CLI contra HTTP local
  helpers/in-memory-workbook-storage.ts Mock de almacenamiento para servicios
```

La factoría `createApplication({ config, workbookStorage, sessions, logger })` permite inyectar configuración, almacenamiento y servicios para probar la aplicación. En producción recibe la configuración del entorno e instancia el adaptador WebDAV; las pruebas del lobby inyectan almacenamiento en memoria. TypeScript se ejecuta con Node.js en desarrollo y se compila a `dist/` para `npm start`. Se conservan las dependencias existentes, sin framework frontend ni nuevas librerías de ejecución.

`package.json` fija mediante `overrides` la dependencia UUID de ExcelJS en la rama 11 a partir de 11.1.1, que corrige el [aviso GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). ExcelJS conserva su versión y utiliza la API `v4` de esa dependencia.

Se conservan las instrucciones en `AGENTS.md` y la licencia original en `LICENSE`.
