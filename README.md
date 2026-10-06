# Open Quiz

Aplicación educativa de cuestionarios en tiempo real, con frontend sencillo y sin cuentas ni base de datos.

**Estado actual: Fases 1, 2, 3 y 4 terminadas.** Esta versión sirve una página inicial, permite comprobar la conexión con Socket.IO y ofrece `GET /health`. Incluye el dominio de sesiones y participantes en memoria, la función de puntuación, la lectura y validación de preguntas XLSX desde un `Buffer` y un adaptador Nextcloud/WebDAV para descargar y subir libros desde el backend. La creación de partidas desde el navegador se implementará en la Fase 5.

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

`npm run format:check` comprueba el formato sin modificar archivos y `npm run test:watch` ejecuta las pruebas al editar. Las pruebas cubren la configuración, `/health`, el frontend estático, la conexión real de Socket.IO mediante polling y WebSocket, el dominio de sesiones, participantes y puntuación, y la importación de XLSX. También prueban WebDAV con un cliente simulado y con el cliente real contra un servidor HTTP local: autenticación, rutas con caracteres especiales, transmisión de bytes, errores, cancelación por timeout y el comando de prueba manual. Los fixtures de Excel están en `tests/fixtures/excel/` y pueden regenerarse con `npm run fixtures:excel`. Las pruebas no requieren Nextcloud ni servicios externos; necesitan poder abrir puertos locales.

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
| `SESSION_TTL_MINUTES`               | `120`                | Reservada para fases posteriores                       |
| `FINISHED_SESSION_TTL_MINUTES`      | `30`                 | Reservada para fases posteriores                       |

Las variables reservadas figuran en `.env.example`, pero todavía no se leen ni validan. En esta fase, los puntos máximos y los TTL se configuran mediante argumentos del dominio; se conectarán a las variables de entorno al integrar el flujo real.

Nextcloud es opcional en esta fase: el servidor arranca con las tres variables de conexión ausentes o vacías. Si configuras alguna, debes completar las tres; la configuración parcial o inválida impide arrancar. El timeout se valida al configurar la conexión. Ni la configuración ni las credenciales se envían al navegador o se registran en logs. El servidor valida la configuración al arrancar, pero todavía no realiza conexiones automáticas a Nextcloud.

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

`cleanupExpired({ sessionTtlMs, finishedSessionTtlMs })` elimina sesiones sin actividad al alcanzar el primer TTL y sesiones terminadas al alcanzar el segundo, medido desde `finishedAt`. Elimina también el índice de código. Ambos límites son enteros positivos en milisegundos. La limpieza se invoca explícitamente; todavía no hay un temporizador de limpieza conectado al servidor web.

`calculatePoints({ isCorrect, elapsedMs, durationMs, maxPoints })` aplica la fórmula lineal, redondea a entero y limita el resultado a `[0, maxPoints]`. El máximo predeterminado es 1000. Una respuesta incorrecta o recibida al alcanzar o superar la duración obtiene cero puntos. Los tiempos negativos se limitan a cero; las duraciones no positivas, los números no finitos y los máximos inválidos generan un error. Los tiempos del dominio se expresan en milisegundos y, al integrar el juego, procederán del reloj del servidor.

## HTTP y conexión en tiempo real

- `GET /`: página inicial con el estado de conexión.
- `GET /health`: responde exactamente con `{"status":"ok"}`.
- `/socket.io/`: transporte Socket.IO y cliente JavaScript servido desde la propia aplicación.

Solo se utilizan los eventos de conexión incorporados de Socket.IO. Los eventos del juego se definirán en las fases correspondientes. No se habilita CORS para otros orígenes.

## Uso por profesor y alumnos

Esta fase permite abrir la página y comprobar que el servidor responde. La creación de partidas, los códigos de acceso y la entrada con nick están pendientes de la Fase 5; la mecánica de preguntas está prevista para la Fase 6.

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
  app.ts            Express, archivos estáticos y Socket.IO sobre un servidor HTTP
  server.ts         Arranque, logs de inicio y cierre del servidor
  config/
    env.ts          Lectura y validación de la configuración de la aplicación
    nextcloud.ts    Configuración opcional de WebDAV y validación sin secretos en errores
  domain/
    identifiers.ts  Generación criptográfica de códigos y tokens
    errors.ts       Errores de dominio con código y mensaje comprensible
    participant/    Modelo y normalización del nick
    session/        Modelo, transiciones y repositorio en memoria
    scoring/        Función de puntuación lineal
    question/       Modelo de pregunta importada, exclusivo del backend
  excel/
    import-questions.ts    Lectura y validación XLSX desde Buffer
    excel-import-error.ts  Errores de importación con hoja y celda
  services/
    session-service.ts  Creación, participantes, reconexión y limpieza
    workbook-storage.ts        Contrato de descarga/subida en memoria
    workbook-storage-error.ts  Errores seguros de almacenamiento
  nextcloud/
    nextcloud-webdav-workbook-storage.ts  Implementación WebDAV autenticada
scripts/
  check-nextcloud.ts Prueba manual de descarga/importación y subida opcional
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
  excel-import.test.ts       Lectura real de XLSX, cabeceras y filas inválidas
  fixtures/excel/            Libros de prueba y generador reproducible
  nextcloud-config.test.ts              Validación de conexión y credenciales
  nextcloud-storage.test.ts             Adaptador con cliente simulado
  nextcloud-storage-integration.test.ts Cliente WebDAV y CLI contra HTTP local
  helpers/in-memory-workbook-storage.ts Mock de almacenamiento para servicios
```

La factoría `createApplication()` permite probar la aplicación sin arrancar el proceso de producción. TypeScript se ejecuta con Node.js en desarrollo y se compila a `dist/` para `npm start`. Express, Socket.IO, ExcelJS y WebDAV son las dependencias de ejecución; las herramientas de calidad y los clientes de prueba son dependencias de desarrollo.

`package.json` fija mediante `overrides` la dependencia UUID de ExcelJS en la rama 11 a partir de 11.1.1, que corrige el [aviso GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). ExcelJS conserva su versión y utiliza la API `v4` de esa dependencia.

Se conservan las instrucciones en `AGENTS.md` y la licencia original en `LICENSE`.
