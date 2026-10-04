# AGENTS.md — Quiz educativo en tiempo real con Nextcloud

## 1. Propósito de este documento

Este archivo define las instrucciones de proyecto para desarrollar, desde Visual Studio Code con Codex, una aplicación web educativa de preguntas tipo Kahoot.

Codex debe tratar este documento como la especificación principal del proyecto.

El desarrollo debe hacerse de forma incremental. No se debe intentar implementar toda la aplicación en una sola tarea. Cada fase debe quedar funcional, probada y razonablemente limpia antes de pasar a la siguiente.

---

# 2. Objetivo del proyecto

Crear una aplicación web sencilla de cuestionarios en tiempo real con las siguientes características principales:

- Sin login.
- Sin base de datos.
- Profesor y alumnos acceden desde un navegador.
- Los alumnos pueden utilizar el móvil.
- Comunicación en tiempo real mediante WebSockets usando Socket.IO.
- Las preguntas se obtienen de una hoja de cálculo `.xlsx` almacenada en Nextcloud.
- Los resultados de cada pregunta se escriben en ese mismo libro de Excel.
- El estado de una partida activa se mantiene en memoria en el servidor.
- La aplicación debe poder desplegarse mediante Docker en servicios gratuitos compatibles con WebSockets, como Render, Koyeb o Northflank.
- El frontend debe ser sencillo y ligero. No utilizar React, Vue, Angular ni otro framework frontend salvo que posteriormente se solicite expresamente.

El proyecto debe priorizar:

1. simplicidad;
2. claridad del código;
3. facilidad de despliegue;
4. robustez suficiente para uso en un aula;
5. facilidad de mantenimiento.

---

# 3. Stack tecnológico inicial

Utilizar, salvo que exista una razón técnica clara para cambiarlo:

## Backend

- Node.js en una versión LTS actual.
- TypeScript.
- Express.
- Socket.IO.
- ExcelJS para lectura y escritura de `.xlsx`.
- Un cliente WebDAV mantenido para acceder a Nextcloud.
- Zod, Joi o equivalente para validación de datos de entrada, preferiblemente Zod.

## Frontend

- HTML.
- CSS.
- JavaScript o TypeScript sencillo.
- Socket.IO Client.
- Sin framework SPA.

## Calidad

- ESLint.
- Prettier.
- Vitest o equivalente para pruebas unitarias.
- Supertest para API HTTP cuando sea necesario.
- Cliente Socket.IO de pruebas para pruebas de integración en tiempo real.

## Despliegue

- Docker.
- Un único contenedor.
- Una única aplicación Node.js que sirva frontend, API HTTP y Socket.IO.
- El puerto debe obtenerse de `process.env.PORT`.
- No depender de almacenamiento local persistente.

---

# 4. Restricciones obligatorias

Estas restricciones forman parte del diseño y no deben cambiarse sin autorización explícita.

## 4.1. Sin base de datos

No utilizar:

- PostgreSQL.
- MySQL/MariaDB.
- SQLite.
- MongoDB.
- Redis.
- Firebase.
- Supabase.
- servicios externos equivalentes.

Las partidas activas se almacenarán en memoria.

Si el proceso del servidor se reinicia durante una partida, inicialmente se admite que la partida activa se pierda.

La recuperación de partidas podrá estudiarse más adelante utilizando el propio fichero XLSX, pero NO forma parte del primer MVP.

## 4.2. Sin autenticación de usuarios

No existe:

- cuenta de profesor;
- cuenta de alumno;
- contraseña de alumno;
- registro.

El profesor debe quedar identificado dentro de una sesión mediante un token secreto aleatorio creado por el servidor y conservado únicamente en su navegador.

Los alumnos entran mediante:

- código de sesión;
- nick.

## 4.3. Nextcloud

Las credenciales o secretos para acceder a Nextcloud:

- nunca deben enviarse al navegador;
- nunca deben incluirse en el repositorio;
- nunca deben aparecer en logs;
- deben permanecer exclusivamente en el backend.

La integración debe abstraerse detrás de un servicio o adaptador para poder sustituir fácilmente el mecanismo WebDAV.

## 4.4. Excel

En el MVP solo se soportará `.xlsx`.

No añadir soporte para:

- `.ods`;
- CSV;
- Google Sheets;
- Microsoft Excel Online;

salvo petición posterior.

---

# 5. Flujo funcional

## 5.1. Profesor: creación de partida

El profesor accede a la página principal y selecciona la opción para crear una partida.

Debe proporcionar los datos necesarios para localizar la hoja `.xlsx` de Nextcloud.

La aplicación:

1. accede al fichero desde el backend;
2. descarga temporalmente el contenido a memoria;
3. valida su formato;
4. carga las preguntas;
5. crea una sesión;
6. genera un identificador interno seguro;
7. genera un código corto para alumnos;
8. genera un token secreto de profesor;
9. muestra la sala de espera.

Ejemplo de código de partida:

`XF82KP`

El código debe:

- ser suficientemente corto para escribirlo desde un móvil;
- evitar caracteres ambiguos si es posible;
- ser único entre las sesiones activas;
- regenerarse automáticamente si existe una colisión.

No utilizar el código corto como secreto.

---

# 6. Formato de la hoja de cálculo

## 6.1. Hoja de preguntas

Por defecto, utilizar la primera hoja del libro.

Opcionalmente podrá aceptarse una hoja denominada `Preguntas` si existe.

Cada fila representa una pregunta.

Formato:

| Columna | Contenido |
|---|---|
| A | Pregunta |
| B | Respuesta correcta |
| C | Respuesta incorrecta 1 |
| D | Respuesta incorrecta 2 |
| E | Respuesta incorrecta 3 |

La primera fila puede ser una cabecera.

El importador debe detectar de forma clara si existe cabecera.

No asumir silenciosamente formatos ambiguos.

Cada pregunta válida debe tener:

- texto de pregunta no vacío;
- una respuesta correcta;
- exactamente tres respuestas incorrectas no vacías.

En el MVP no se admiten:

- imágenes;
- respuestas múltiples correctas;
- preguntas de texto libre;
- vídeos;
- fórmulas como respuestas.

---

# 7. Resultados en Excel

Al finalizar cada pregunta se debe escribir una nueva pestaña en EL MISMO libro `.xlsx`.

Nombres previstos:

- `P01`
- `P02`
- `P03`
- ...

Cada pestaña de resultados tendrá:

| Columna | Contenido |
|---|---|
| A | Nick |
| B | Ha acertado |
| C | Tiempo empleado |
| D | Puntos de la pregunta |
| E | Puntos totales |

Primera fila:

`Nick | Acertada | Tiempo | Puntos pregunta | Puntos totales`

Valores recomendados:

- `Acertada`: `Sí` / `No`.
- `Tiempo`: segundos con tres decimales o milisegundos, pero utilizar un único criterio en todo el proyecto.
- Puntos: entero.
- Total: entero.

Se debe crear una fila para TODOS los participantes que estuvieran incorporados a la partida en esa pregunta.

Si un participante no responde:

- `Acertada = No`
- tiempo = tiempo máximo de la pregunta o un valor claramente documentado;
- puntos = 0.

El libro debe actualizarse una única vez al finalizar cada pregunta.

NO escribir en Nextcloud cada vez que responde un alumno.

Debe existir un bloqueo lógico por sesión que impida dos escrituras simultáneas del mismo libro.

---

# 8. Mecánica de las preguntas

El profesor controla el avance.

Estados mínimos de una sesión:

```text
LOBBY
QUESTION_ACTIVE
QUESTION_RESULTS
FINISHED
```

Flujo:

```text
LOBBY
  ↓
Profesor inicia
  ↓
QUESTION_ACTIVE
  ↓
termina tiempo o profesor cierra
  ↓
QUESTION_RESULTS
  ↓
profesor pulsa siguiente
  ↓
QUESTION_ACTIVE
  ↓
...
  ↓
FINISHED
```

No avanzar automáticamente a la siguiente pregunta.

---

# 9. Orden de preguntas y respuestas

Mantener inicialmente el orden de las preguntas existente en el Excel.

Las cuatro respuestas de cada pregunta deben mezclarse.

El orden aleatorio debe generarse UNA SOLA VEZ en el servidor al iniciar la pregunta.

Todos los alumnos deben recibir:

- la misma pregunta;
- las mismas cuatro respuestas;
- en el mismo orden.

El navegador nunca debe recibir información indicando cuál es la respuesta correcta mientras la pregunta esté activa.

---

# 10. Tiempo de respuesta

El servidor es la autoridad temporal.

Al abrir una pregunta:

```text
questionStartedAt = tiempo del servidor
```

Cuando llega una respuesta:

```text
elapsed = receivedAt - questionStartedAt
```

No aceptar como fiable ningún tiempo calculado por el navegador.

El cliente puede mostrar un contador visual, pero la puntuación siempre se calcula utilizando el tiempo del servidor.

Debe existir un tiempo máximo configurable por pregunta o por partida.

Para el MVP:

```text
DEFAULT_QUESTION_DURATION_SECONDS=20
```

---

# 11. Puntuación

Para el MVP utilizar una fórmula lineal.

Máximo inicial:

```text
MAX_POINTS_PER_QUESTION=1000
```

Si la respuesta es incorrecta:

```text
puntos = 0
```

Si es correcta:

```text
puntos = MAX_POINTS * (tiempoMaximo - tiempoEmpleado) / tiempoMaximo
```

Aplicar límites:

```text
0 <= puntos <= MAX_POINTS
```

Redondear el resultado a entero.

Ejemplo con 20 segundos:

| Tiempo | Puntos aproximados |
|---:|---:|
| 0 s | 1000 |
| 5 s | 750 |
| 10 s | 500 |
| 15 s | 250 |
| 20 s | 0 |

La función de puntuación debe estar aislada y cubierta por pruebas unitarias.

No añadir rachas, bonus u otras mecánicas en el MVP.

---

# 12. Participantes

Cada participante tendrá como mínimo:

```ts
Participant {
  id
  nick
  reconnectToken
  socketId
  connected
  totalPoints
}
```

El servidor asignará un identificador interno.

El nick:

- no debe estar vacío;
- debe recortarse;
- debe tener una longitud máxima razonable;
- debe escaparse/sanitizarse al mostrarse;
- debe rechazarse si ya está siendo usado en la misma sesión, ignorando mayúsculas/minúsculas.

No utilizar el nick como identificador interno.

---

# 13. Reconexión

El alumno recibirá un `reconnectToken` aleatorio.

Se guardará en `localStorage`.

Si pierde temporalmente la conexión:

1. vuelve a conectar;
2. envía código de partida + identificador/token de reconexión;
3. el servidor recupera su participante;
4. no pierde sus puntos.

Nunca utilizar únicamente el nick para reconectar.

El MVP debe soportar una reconexión razonable dentro de la misma instancia del servidor.

---

# 14. Respuestas

Por cada pregunta:

- un alumno solo puede responder una vez;
- la primera respuesta válida queda registrada;
- las respuestas posteriores se ignoran;
- no se puede responder antes de iniciar la pregunta;
- no se puede responder después de cerrar la pregunta;
- no se debe aceptar un índice de respuesta inexistente.

El cliente enviará preferiblemente:

```text
questionId
answerOptionId
```

No enviar el texto de la respuesta como dato de confianza.

---

# 15. Podio y clasificación

Después de cada pregunta:

1. calcular puntuaciones;
2. actualizar totales;
3. ordenar participantes;
4. mostrar clasificación.

Orden principal:

```text
totalPoints DESC
```

Definir y documentar un criterio estable para empates.

Al finalizar:

- mostrar podio de los tres primeros;
- mostrar clasificación completa al profesor;
- mostrar al alumno su posición y puntuación.

---

# 16. Estado en memoria

Crear una capa de dominio independiente de Socket.IO.

Una estructura conceptual posible:

```ts
Session {
  id
  joinCode
  teacherToken
  state
  workbookReference
  questions
  currentQuestionIndex
  currentQuestion
  participants
  answers
  createdAt
}
```

No acoplar directamente toda la lógica de negocio a los handlers de Socket.IO.

Separar al menos:

```text
domain/
services/
realtime/
routes/
nextcloud/
excel/
```

La estructura final puede variar si Codex encuentra una alternativa más sencilla y clara.

---

# 17. Eventos Socket.IO

Utilizar eventos explícitos y documentados.

## Profesor → servidor

Como referencia:

```text
teacher:create-session
teacher:start-game
teacher:start-next-question
teacher:close-question
teacher:end-game
```

## Alumno → servidor

```text
student:join
student:reconnect
student:answer
```

## Servidor → clientes

```text
session:created
lobby:updated
question:started
answer:accepted
question:ended
ranking:updated
game:ended
app:error
```

Los nombres pueden ajustarse durante la implementación, pero deben:

- ser consistentes;
- tener tipos TypeScript;
- estar documentados;
- validar todos los payloads entrantes.

Usar rooms de Socket.IO para separar partidas.

Nunca emitir información de una partida a otra.

---

# 18. HTTP

Mantener la API HTTP al mínimo.

HTTP puede utilizarse para:

- servir los archivos estáticos;
- health check;
- operaciones de creación/configuración que tengan más sentido por HTTP;
- integración Nextcloud cuando sea conveniente.

La interacción del juego será principalmente por Socket.IO.

Endpoint obligatorio:

```text
GET /health
```

Respuesta esperada:

```json
{
  "status": "ok"
}
```

No incluir secretos ni información de sesiones en `/health`.

---

# 19. Integración con Nextcloud

Crear una interfaz desacoplada, por ejemplo:

```ts
interface WorkbookStorage {
  downloadWorkbook(reference): Promise<Buffer>
  uploadWorkbook(reference, data: Buffer): Promise<void>
}
```

Implementación inicial:

```text
NextcloudWebDavWorkbookStorage
```

El resto de la aplicación no debe necesitar conocer detalles de WebDAV.

El backend debe soportar de forma evolutiva:

1. enlaces compartidos que permitan acceso WebDAV;
2. WebDAV autenticado mediante usuario + contraseña de aplicación.

No implementar ambos modos simultáneamente si complica innecesariamente la primera fase.

Primero crear la abstracción y después implementar el modo que se decida probar.

Nunca registrar:

- contraseñas;
- tokens;
- URLs que contengan credenciales.

---

# 20. Escritura segura del XLSX

Al cerrar una pregunta:

```text
1. Obtener un lock de escritura de esa sesión.
2. Descargar la versión actual del libro.
3. Abrir con ExcelJS.
4. Crear la hoja Pxx.
5. Escribir los resultados.
6. Serializar el libro.
7. Subirlo a Nextcloud.
8. Liberar lock.
```

No mantener una copia local como fuente de verdad durante toda la partida.

Esto reduce el riesgo de sobrescribir cambios realizados entre preguntas.

Si la hoja `Pxx` ya existe:

- NO sobrescribir silenciosamente;
- generar un error claro o utilizar una estrategia explícita y documentada.

En el MVP, preferir error seguro.

---

# 21. Concurrencia

La aplicación debe poder tener varias sesiones simultáneas.

Cada sesión debe estar completamente aislada.

No utilizar variables globales como:

```text
currentQuestion
players
score
```

sin estar asociadas a una sesión.

Utilizar un repositorio en memoria, por ejemplo:

```ts
Map<SessionId, Session>
```

Crear una política sencilla de limpieza:

- eliminar una sesión terminada después de un TTL;
- eliminar sesiones abandonadas después de un periodo razonable.

Los valores deben ser configurables.

---

# 22. Seguridad mínima

Aunque sea una aplicación sin login, aplicar estas medidas:

- validar todos los datos procedentes del navegador;
- limitar tamaño de payloads;
- limitar longitud del nick;
- escapar contenido antes de insertarlo en HTML;
- no utilizar `innerHTML` con contenido de usuario salvo sanitización explícita;
- no enviar la respuesta correcta antes del cierre;
- profesor identificado mediante token secreto;
- token de profesor con entropía criptográfica;
- identificadores/token mediante `crypto.randomUUID()` o `crypto.randomBytes()`;
- rate limiting razonable en operaciones susceptibles de abuso;
- CORS restrictivo en producción;
- no exponer stack traces en producción;
- no mostrar secretos en logs.

No implementar sistemas complejos de autenticación o autorización fuera de alcance.

---

# 23. Interfaz de profesor

Pantallas/estados previstos:

## Inicio

```text
Quiz en tiempo real
[ Crear partida ]
```

## Configuración

Campos mínimos necesarios para localizar el XLSX de Nextcloud.

```text
[ Dirección/referencia del fichero ]
[ Crear partida ]
```

## Sala de espera

Mostrar:

- código grande;
- URL para alumnos;
- QR si se implementa;
- lista de participantes conectados;
- número de participantes;
- botón `Iniciar`.

## Pregunta activa

Mostrar:

- número de pregunta;
- pregunta;
- cuatro respuestas;
- contador;
- número de alumnos que han respondido;
- botón para cerrar pregunta.

NO mostrar cuál es correcta hasta cerrar la pregunta.

## Resultado

Mostrar:

- respuesta correcta;
- estadísticas básicas;
- ranking;
- botón `Siguiente pregunta`.

## Final

Mostrar:

- podio;
- clasificación completa;
- indicación de que los resultados se han guardado en Nextcloud.

---

# 24. Interfaz de alumno

## Entrada

```text
Código de partida
Nick
[ Entrar ]
```

## Espera

```text
Te has unido como: Ana
Esperando al profesor...
```

## Pregunta

Mostrar:

- pregunta;
- cuatro botones grandes;
- contador.

Diseñar primero para móvil.

## Después de responder

Bloquear las respuestas.

Mostrar:

```text
Respuesta enviada
```

No revelar todavía si ha acertado.

## Resultado de pregunta

Mostrar:

- correcto/incorrecto;
- puntos obtenidos;
- total;
- posición aproximada o actual.

## Final

Mostrar:

- puesto;
- total de puntos;
- podio.

---

# 25. Diseño visual

Objetivo:

- limpio;
- muy legible;
- botones grandes;
- responsive;
- usable en móvil;
- sin dependencias visuales grandes.

No copiar diseño, logotipos, nombre comercial ni elementos gráficos propios de Kahoot.

La aplicación puede inspirarse en la mecánica general de un quiz en tiempo real, pero debe tener identidad visual propia.

Priorizar accesibilidad:

- buen contraste;
- foco visible;
- botones utilizables con teclado;
- etiquetas accesibles;
- no transmitir información únicamente mediante color.

---

# 26. Variables de entorno

Crear `.env.example`.

Variables previstas:

```env
PORT=3000
NODE_ENV=development

DEFAULT_QUESTION_DURATION_SECONDS=20
MAX_POINTS_PER_QUESTION=1000

SESSION_TTL_MINUTES=120
FINISHED_SESSION_TTL_MINUTES=30
```

Las variables de Nextcloud se definirán cuando se implemente el método concreto de conexión.

Nunca incluir `.env` real en Git.

---

# 27. Estructura inicial orientativa

Codex puede mejorarla si mantiene la separación de responsabilidades.

```text
/
├── AGENTS.md
├── README.md
├── package.json
├── tsconfig.json
├── eslint.config.*
├── .prettierrc
├── .gitignore
├── .env.example
├── Dockerfile
├── src/
│   ├── server.ts
│   ├── config/
│   ├── domain/
│   │   ├── session/
│   │   ├── participant/
│   │   ├── question/
│   │   └── scoring/
│   ├── services/
│   ├── realtime/
│   ├── routes/
│   ├── nextcloud/
│   ├── excel/
│   └── utils/
├── public/
│   ├── index.html
│   ├── teacher.html
│   ├── student.html
│   ├── css/
│   └── js/
└── tests/
```

Evitar una arquitectura excesivamente compleja.

No crear capas, patrones o abstracciones que no aporten valor.

---

# 28. Pruebas mínimas obligatorias

## Puntuación

Probar:

- respuesta incorrecta = 0;
- 0 segundos ≈ máximo;
- mitad del tiempo ≈ mitad de puntos;
- tiempo máximo = 0;
- tiempo superior al máximo = 0;
- nunca puntos negativos;
- nunca más del máximo.

## Sesiones

Probar:

- creación;
- código único;
- transición de estados;
- varios juegos simultáneos aislados.

## Participantes

Probar:

- join;
- nick duplicado;
- reconexión;
- respuesta única por pregunta.

## Excel

Utilizar fixtures de prueba.

Probar:

- fichero válido;
- fila incompleta;
- cabecera;
- creación de P01;
- columnas correctas;
- participantes sin respuesta;
- no sobrescribir P01 existente.

## Socket.IO

Al menos una prueba de integración que simule:

1. profesor crea sesión;
2. alumno entra;
3. profesor inicia pregunta;
4. alumno responde;
5. servidor cierra;
6. ranking actualizado.

No exigir acceso real a Nextcloud en las pruebas automáticas.

Mockear el almacenamiento.

---

# 29. Logging

Crear logging sencillo y estructurado.

Eventos útiles:

```text
session_created
participant_joined
participant_reconnected
question_started
question_closed
workbook_updated
session_finished
```

No registrar:

- respuestas secretas mientras la pregunta esté activa;
- teacherToken;
- reconnectToken;
- credenciales Nextcloud.

No introducir una plataforma externa de observabilidad en el MVP.

---

# 30. Gestión de errores

Todos los errores mostrados al usuario deben ser comprensibles.

Ejemplos:

```text
No se ha podido acceder al fichero de Nextcloud.
El fichero no tiene el formato esperado.
El código de partida no existe.
Ese nick ya está siendo utilizado.
La pregunta ya ha terminado.
No se han podido guardar los resultados.
```

Los detalles técnicos pueden registrarse en servidor, sin secretos.

Si falla la escritura en Nextcloud al final de una pregunta:

- conservar en memoria el resultado;
- mostrar el error al profesor;
- permitir reintentar la escritura;
- no perder el ranking;
- no crear silenciosamente estados inconsistentes.

---

# 31. Rendimiento esperado

Objetivo inicial de diseño:

```text
1 profesor
hasta 40 alumnos por partida
varias partidas pequeñas simultáneas
```

No realizar optimizaciones prematuras.

La arquitectura debe evitar operaciones O(n²) innecesarias, pero la prioridad es claridad.

---

# 32. Compatibilidad de despliegue

La aplicación debe:

- arrancar con un único comando;
- escuchar en `0.0.0.0`;
- usar `process.env.PORT`;
- funcionar detrás de un reverse proxy HTTPS;
- soportar WebSockets;
- no necesitar disco persistente;
- disponer de Dockerfile.

No incluir configuraciones específicas de Render, Koyeb o Northflank en la lógica de aplicación.

Si se necesitan, utilizar ficheros de despliegue independientes.

---

# 33. README

Mantener `README.md` actualizado.

Debe incluir como mínimo:

- descripción;
- requisitos;
- instalación;
- ejecución en desarrollo;
- pruebas;
- variables de entorno;
- formato del Excel;
- uso profesor;
- uso alumno;
- Docker;
- arquitectura resumida.

No duplicar toda la información de `AGENTS.md`.

`AGENTS.md` está orientado a Codex y desarrollo.

`README.md` está orientado a personas que usan o mantienen la aplicación.

---

# 34. Forma de trabajar para Codex

Antes de modificar código:

1. leer este `AGENTS.md`;
2. inspeccionar los archivos existentes;
3. identificar la fase actual;
4. no asumir que archivos descritos aquí existen todavía;
5. proponer cambios simples compatibles con la arquitectura.

Después de cada tarea:

1. ejecutar formatter;
2. ejecutar linter;
3. ejecutar pruebas;
4. corregir fallos provocados por el cambio;
5. indicar brevemente:
   - qué se ha hecho;
   - qué archivos principales se han tocado;
   - qué pruebas se han ejecutado;
   - qué queda pendiente.

No hacer refactors grandes no solicitados.

No cambiar librerías principales sin justificarlo.

No añadir dependencias si la plataforma estándar de Node.js resuelve el problema de forma sencilla.

No implementar funcionalidades futuras anticipadamente.

---

# 35. Desarrollo por fases

## Fase 1 — Esqueleto del proyecto

Objetivo:

crear una aplicación mínima ejecutable.

Implementar:

- npm;
- TypeScript;
- Express;
- Socket.IO;
- configuración;
- ESLint;
- Prettier;
- Vitest;
- `GET /health`;
- frontend estático mínimo;
- `.env.example`;
- `.gitignore`;
- README inicial.

Criterio de aceptación:

```text
npm install
npm run dev
npm test
npm run lint
```

deben funcionar.

No implementar todavía Nextcloud ni Excel.

---

## Fase 2 — Dominio y sesiones en memoria

Implementar:

- modelos/tipos;
- repositorio en memoria;
- generación de ID;
- generación de join code;
- teacher token;
- estados de sesión;
- participantes;
- puntuación;
- tests.

Sin interfaz compleja.

Sin Nextcloud todavía.

---

## Fase 3 — Lectura y validación XLSX

Implementar:

- servicio Excel;
- lectura desde Buffer;
- detección de hoja;
- detección de cabecera;
- validación de filas;
- conversión a preguntas de dominio;
- fixtures;
- tests.

Todavía puede usarse un fichero local únicamente en pruebas.

---

## Fase 4 — Adaptador Nextcloud/WebDAV

Implementar:

- interfaz `WorkbookStorage`;
- implementación WebDAV;
- descarga a Buffer;
- subida desde Buffer;
- manejo de errores;
- configuración mediante entorno;
- mock para tests.

Crear una pequeña prueba manual documentada.

---

## Fase 5 — Crear partida y lobby

Implementar flujo real:

```text
Profesor
  ↓
carga referencia Nextcloud
  ↓
servidor lee XLSX
  ↓
crea sesión
  ↓
genera código
  ↓
alumnos introducen código + nick
  ↓
lobby en tiempo real
```

Implementar reconexión básica.

---

## Fase 6 — Juego en tiempo real

Implementar:

- inicio de pregunta;
- respuestas barajadas;
- cronómetro servidor;
- envío de respuestas;
- una respuesta por participante;
- cierre;
- cálculo de puntuación;
- ranking;
- siguiente pregunta;
- final.

---

## Fase 7 — Escritura de resultados

Implementar al cerrar pregunta:

```text
P01
P02
...
```

con las cinco columnas definidas.

Añadir lock por sesión.

Añadir reintento manual ante fallo.

---

## Fase 8 — Interfaz usable

Mejorar:

- profesor;
- alumno;
- responsive;
- móvil;
- feedback visual;
- contador;
- clasificación;
- podio;
- estados de carga/error;
- accesibilidad.

No convertir la aplicación a SPA.

---

## Fase 9 — Docker y despliegue

Crear:

- Dockerfile;
- `.dockerignore`;
- instrucciones de despliegue;
- health check compatible con hosting.

Validar WebSockets detrás de proxy.

El mismo contenedor debe poder desplegarse al menos conceptualmente en:

- Render;
- Koyeb;
- Northflank.

---

## Fase 10 — Endurecimiento del MVP

Revisar:

- validación;
- XSS;
- tokens;
- rate limiting;
- errores;
- fugas de información;
- concurrencia;
- cleanup de sesiones;
- desconexiones;
- escrituras Nextcloud;
- tests de flujo completo.

Solo después de esta fase considerar nuevas funcionalidades.

---

# 36. Funcionalidades fuera del MVP

NO implementar todavía:

- login;
- cuentas;
- base de datos;
- panel de administración;
- histórico global;
- imágenes;
- vídeos;
- sonidos;
- equipos;
- importación CSV;
- importación ODS;
- Google Drive;
- Microsoft 365;
- IA;
- preguntas generadas automáticamente;
- banco de preguntas;
- avatares;
- chat;
- moderación avanzada;
- múltiples profesores por partida;
- escalado horizontal con Redis;
- recuperación automática de partidas tras reinicio;
- aplicación móvil nativa.

Estas mejoras pueden evaluarse después de tener el MVP funcionando.

---

# 37. Decisiones de diseño importantes

Cuando haya que elegir entre:

```text
más tecnología
```

y

```text
una solución sencilla que cumpla los requisitos
```

preferir la segunda.

Ejemplos:

- Vanilla JS antes que React.
- Estado en memoria antes que Redis.
- Una aplicación antes que microservicios.
- Una función clara antes que un patrón complejo.
- Un Dockerfile sencillo antes que Kubernetes.

---

# 38. Definición de MVP terminado

El MVP se considera terminado cuando se pueda demostrar este flujo:

```text
1. Existe un XLSX válido en Nextcloud.

2. El profesor abre la web.

3. Selecciona/indica el XLSX.

4. La aplicación crea una partida y muestra un código.

5. Tres o más alumnos entran desde sus móviles con un nick.

6. El profesor ve a los alumnos en el lobby.

7. Inicia la partida.

8. Todos reciben simultáneamente la misma pregunta.

9. Cada alumno responde.

10. El servidor calcula tiempo y puntuación.

11. Se muestra el ranking.

12. Se crea P01 en el XLSX de Nextcloud.

13. El profesor pasa a la siguiente pregunta.

14. Se repite el proceso.

15. Al terminar se muestra un podio.

16. El XLSX contiene una pestaña por pregunta con:
    nick,
    acierto,
    tiempo,
    puntos de pregunta,
    puntos acumulados.
```

Todo ello:

- sin login;
- sin base de datos;
- con comunicación en tiempo real;
- desplegable mediante Docker.

---

# 39. Primera tarea para Codex

Cuando se solicite iniciar el desarrollo, comenzar EXCLUSIVAMENTE por la **Fase 1 — Esqueleto del proyecto**.

Antes de escribir archivos:

1. resumir en pocas líneas la estructura que se va a crear;
2. comprobar si la carpeta ya contiene algún proyecto;
3. conservar cualquier contenido existente que sea compatible.

Después:

- crear el esqueleto;
- instalar/configurar únicamente las dependencias necesarias para Fase 1;
- crear `/health`;
- crear una página inicial mínima;
- añadir scripts npm;
- añadir tests;
- ejecutar las comprobaciones.

No implementar Nextcloud, Excel, lobby ni lógica de juego en esta primera tarea.

Al terminar, detenerse y presentar el resultado de Fase 1 antes de avanzar.
