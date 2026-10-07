# Despliegue de Open Quiz

La misma imagen sirve el frontend, HTTP y Socket.IO desde un único proceso Node.js 24. Solo necesita un puerto HTTP interno, salida HTTPS hacia Nextcloud y **una
instancia**. El proveedor termina TLS y permite HTTPS y WSS desde el navegador.
La aplicación escucha en `0.0.0.0` y lee `PORT` al arrancar.

Las partidas, puntuaciones pendientes y locks están en memoria. Un reinicio,
redeploy o suspensión elimina las sesiones; los resultados ya guardados permanecen
en Nextcloud. Despliega entre clases. No actives varias réplicas ni autoescalado
horizontal: dirigirían participantes a repositorios distintos y separarían los
locks del mismo libro.

## Construir y ejecutar con Docker

Desde la raíz del repositorio, con Docker Engine o Docker Desktop en ejecución:

```sh
docker build --pull -t open-quiz:local .
docker run --rm --name open-quiz -p 3000:3000 open-quiz:local
```

Abre <http://localhost:3000> y comprueba:

```sh
curl --fail http://localhost:3000/health
docker inspect --format '{{.State.Health.Status}}' open-quiz
```

La respuesta debe ser `{"status":"ok"}` y, tras el primer health check,
`healthy`. El health check se ejecuta cada 30 segundos, con tres intentos fallidos
antes de marcar la imagen como `unhealthy`. Comprueba el servicio HTTP, no la
disponibilidad de Nextcloud; las credenciales se validan al arrancar y el libro
se descarga al crear una partida.

Para jugar, copia `.env.example` a `.env` y configura las tres variables de
Nextcloud en ese archivo local. Inyéctalas solo al ejecutar:

```sh
docker run --rm --name open-quiz --env-file .env \
  -e NODE_ENV=production -p 3000:3000 open-quiz:local
```

Los valores `-e` prevalecen sobre el archivo. No incluyas `.env` en Git ni pases
credenciales como argumentos de construcción: no hacen falta para compilar.
`.dockerignore` permite únicamente el código y los archivos necesarios; excluye
también archivos de entorno y claves dentro de las carpetas permitidas. No montes
el repositorio ni volúmenes de datos en producción.

Para utilizar otro puerto interno:

```sh
docker run --rm --name open-quiz --env-file .env \
  -e NODE_ENV=production -e PORT=8080 -p 8080:8080 open-quiz:local
```

Tanto el servidor como el health check usarán `8080`. `EXPOSE 3000` documenta el
puerto predeterminado; debes publicar o configurar el puerto efectivo del entorno.

La construcción usa `npm ci` y `package-lock.json`. La imagen final contiene
`dist/`, `public/`, el health check y dependencias de producción, sin TypeScript,
Vitest ni herramientas de desarrollo. Ejecuta `node dist/server.js` como usuario
sin privilegios. Para comprobarlo y detener el proceso:

```sh
docker exec open-quiz node -p 'process.getuid()'
docker exec open-quiz node scripts/healthcheck.mjs
docker stop --time 10 open-quiz
```

El UID debe ser `1000`, el comando de salud debe terminar con código 0 y la parada
envía `SIGTERM` directamente a Node. La aplicación cierra Socket.IO y sus
temporizadores. También puede ejecutarse con `--read-only`; no necesita escribir
libros ni sesiones en el sistema de archivos.

## Configuración del hosting

Configura las variables como entorno de **ejecución**, conservando los demás
valores predeterminados de `.env.example` si te sirven:

| Ajuste                 | Valor                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| Método de construcción | Dockerfile de la raíz; contexto `.`; etapa final `runtime`             |
| Comando de inicio      | El `CMD` de la imagen, sin sobrescribirlo                              |
| Entorno                | `NODE_ENV=production`                                                  |
| Puerto                 | El `PORT` efectivo y el mismo puerto HTTP interno en el servicio       |
| Entrada pública        | HTTPS, ruta `/`, WebSockets y `/socket.io/` habilitados                |
| Salud                  | HTTP `GET /health`, respuesta 200                                      |
| Escala                 | Una instancia; sin autoescalado horizontal                             |
| Almacenamiento         | Sin base de datos ni volúmenes persistentes                            |
| Nextcloud              | `NEXTCLOUD_WEBDAV_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_APP_PASSWORD` |

Usa el almacenamiento de secretos del proveedor para la contraseña de aplicación.
La cuenta debe poder leer y modificar el XLSX; Nextcloud debe ser accesible desde
el contenedor. `/health` no muestra la configuración ni los secretos.

### Render

1. Crea un **Web Service** a partir del repositorio y selecciona el entorno Docker.
   Utiliza `./Dockerfile` y la raíz como contexto. Render permite construir y
   desplegar directamente el Dockerfile del repositorio.
   [Documentación de Docker en Render](https://render.com/docs/docker).
2. Configura `PORT=10000`, `NODE_ENV=production` y las variables de Nextcloud como
   entorno de ejecución. Mantén una instancia y el comando de la imagen.
3. En Health Checks establece `/health`.
   [Comprobaciones HTTP de Render](https://render.com/docs/health-checks).
4. Abre la URL HTTPS asignada. El frontend conecta Socket.IO al mismo origen;
   Render admite WebSockets en el puerto del servicio.
   [WebSockets en Render](https://render.com/docs/websocket).

El plan Free puede suspender el servicio tras 15 minutos sin peticiones HTTP ni
mensajes WebSocket entrantes, y puede reiniciarlo. Antes de una clase, abre la web
y espera a que responda; crea la partida después. Consulta las restricciones y
cuotas actuales antes de elegirlo.
[Limitaciones de Render Free](https://render.com/docs/free).

### Koyeb

1. Crea un **Web Service** desde GitHub y selecciona Dockerfile como método de
   construcción, con `Dockerfile` en la raíz. También puedes desplegar una imagen
   ya publicada en un registro.
   [Construcción y despliegue en Koyeb](https://www.koyeb.com/docs/build-and-deploy).
2. Expón el puerto `3000` con protocolo HTTP y ruta `/`; establece `PORT=3000` y
   las variables de ejecución. Koyeb admite aplicaciones WebSocket y asigna
   `PORT` a partir del puerto expuesto si no lo configuras explícitamente.
   [Servicios](https://www.koyeb.com/docs/reference/services) y
   [puertos y rutas](https://www.koyeb.com/docs/build-and-deploy/exposing-your-service).
3. Mantén una instancia y configura el health check HTTP del puerto `3000` con
   ruta `/health`.
   [Health checks de Koyeb](https://www.koyeb.com/docs/run-and-scale/health-checks).
4. Abre el dominio HTTPS del servicio y comprueba el juego con varias pestañas.

### Northflank

1. Crea un servicio que combine construcción y despliegue desde el repositorio.
   Selecciona Dockerfile, ruta `/Dockerfile`, contexto raíz y etapa final `runtime`.
   También puedes desplegar una imagen desde un registro.
   [Construcción con Dockerfile](https://northflank.com/docs/v1/application/build/build-with-a-dockerfile).
2. Configura `PORT=3000`, `NODE_ENV=production` y las variables de Nextcloud en
   el entorno de ejecución. Mantén una sola instancia.
3. Expón públicamente el puerto HTTP `3000`. Northflank termina HTTPS en su
   balanceador y admite WebSockets sobre los puertos HTTP públicos.
   [Red de Northflank](https://northflank.com/docs/v1/application/network/networking-on-northflank).
4. Añade comprobaciones de readiness y liveness de tipo HTTP, puerto `3000` y
   ruta `/health`, por ejemplo con 10 segundos de espera inicial, intervalo de
   30 segundos, timeout de 5 segundos y tres fallos máximos.
   [Configurar health checks](https://northflank.com/docs/v1/application/observe/configure-health-checks).

Los planes, cuotas y condiciones gratuitas pueden cambiar. La compatibilidad del
contenedor no garantiza un plan gratuito disponible ni continuidad de una clase
durante reinicios del proveedor.

## Proxy HTTPS propio

El proxy debe conservar el `Host` público, incluida su parte de puerto si existe,
y reenviar el protocolo HTTP/1.1 y las cabeceras `Upgrade` y `Connection`. La
validación de Socket.IO compara `Origin` con `Host`, también cuando TLS termina
en el proxy. Mantén frontend y Socket.IO bajo el mismo origen y sirve la
aplicación en `/`. No se confía en `X-Forwarded-Host` para autorizar orígenes.

Ejemplo de nginx instalado en el mismo host que el contenedor publicado en
`127.0.0.1:3000` (`-p 127.0.0.1:3000:3000`). Coloca este bloque en el contexto
`http` y ajusta el dominio y las rutas de tus certificados:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name quiz.example.com;
    ssl_certificate /etc/letsencrypt/live/quiz.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/quiz.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_buffering off;
    }
}
```

El timeout debe superar `pingInterval + pingTimeout` de Socket.IO, 45 segundos
con sus valores predeterminados. El ejemplo utiliza 75 segundos.
[Guía oficial de Socket.IO para proxies](https://socket.io/docs/v4/reverse-proxy/).

## Verificación antes de usarlo en clase

La prueba automática termina TLS en un proxy Node local con certificado de prueba
y reenvía al servidor HTTP. El cliente confía explícitamente en ese certificado,
manteniendo la validación TLS. No necesita nginx ni Nextcloud real:

```sh
npm test -- tests/deployment.test.ts tests/proxy-integration.test.ts
```

Comprueba HTTPS para salud y recursos, polling, WebSocket directo, Upgrade de
polling a WebSocket y rechazo de orígenes externos. Simula profesor y tres alumnos
por el proxy, pregunta común, respuestas, ranking, guardado `P01` mediante
almacenamiento simulado y podio. El health check se prueba como proceso Node real
en un puerto variable y ante HTTP o JSON inválidos.

Esta prueba verifica el comportamiento detrás de un proxy; la construcción de la
imagen y el balanceador de cada proveedor necesitan la verificación siguiente:

1. Construye y ejecuta la imagen. Comprueba `/health`, `healthy`, el UID y la
   parada con los comandos anteriores. Repite con `PORT=8080` para verificar que
   no hay dependencia de `3000`.
2. En el hosting, abre `/health` por HTTPS: debe devolver solo `{"status":"ok"}`.
   Abre la página inicial y comprueba que indica conexión activa.
3. En las herramientas de desarrollo del navegador, revisa `/socket.io/`: la
   conexión WebSocket debe responder con **101 Switching Protocols** y continuar
   abierta. Si se queda en polling, revisa Upgrade, rutas y timeout del proxy.
4. Configura Nextcloud y utiliza una copia del XLSX sin hojas `Pxx`. Crea una
   partida y conecta tres alumnos, al menos uno desde un móvil. Comprueba dos
   preguntas, igualdad de opciones, respuestas, ranking y podio.
5. Descarga el libro y comprueba `P01` y `P02`. Recarga una pestaña de alumno
   durante la partida y verifica que recupera puntos y estado.

La Fase 9 no publica un servicio ni crea recursos en cuentas externas. La
verificación real requiere Docker y, para cada proveedor, una cuenta y Nextcloud
configurado.
