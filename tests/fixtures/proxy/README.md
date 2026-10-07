# TLS del proxy de pruebas

`cert.pem` y `key.pem` forman un certificado autofirmado de prueba para
`localhost` y `127.0.0.1`. La clave es pública y se utiliza exclusivamente en
las pruebas locales de HTTPS. No debe reutilizarse en un despliegue.

El cliente de pruebas confía explícitamente en este certificado; se mantiene
la validación TLS. Estos archivos quedan fuera del contexto de Docker.

Para regenerarlos desde la raíz del proyecto:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout tests/fixtures/proxy/key.pem \
  -out tests/fixtures/proxy/cert.pem
```
