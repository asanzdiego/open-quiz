import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config/env.ts';
import {
  readNextcloudConfig,
  NextcloudConfigError,
  validateNextcloudConfig,
} from '../src/config/nextcloud.ts';

const env = {
  NEXTCLOUD_WEBDAV_URL:
    'https://cloud.example.com/nextcloud/remote.php/dav/files/docente/',
  NEXTCLOUD_USERNAME: 'docente',
  NEXTCLOUD_APP_PASSWORD: 'contraseña-de-prueba',
};

describe('Configuración de Nextcloud', () => {
  it('permite arrancar sin Nextcloud o con las credenciales de .env.example vacías', () => {
    expect(readNextcloudConfig({})).toBeUndefined();
    expect(
      readNextcloudConfig({
        NEXTCLOUD_WEBDAV_URL: '',
        NEXTCLOUD_USERNAME: '',
        NEXTCLOUD_APP_PASSWORD: '',
        NEXTCLOUD_REQUEST_TIMEOUT_MS: '15000',
      }),
    ).toBeUndefined();
  });

  it('lee la configuración autenticada con un timeout predeterminado', () => {
    expect(readNextcloudConfig(env)).toEqual({
      webdavUrl: env.NEXTCLOUD_WEBDAV_URL,
      username: env.NEXTCLOUD_USERNAME,
      appPassword: env.NEXTCLOUD_APP_PASSWORD,
      requestTimeoutMs: 15000,
    });
    expect(readConfig(env).nextcloud).toEqual(readNextcloudConfig(env));
  });

  it('normaliza la barra final de la raíz WebDAV y admite un timeout personalizado', () => {
    expect(
      readNextcloudConfig({
        ...env,
        NEXTCLOUD_WEBDAV_URL:
          'https://cloud.example.com/remote.php/dav/files/docente',
        NEXTCLOUD_REQUEST_TIMEOUT_MS: '23000',
      }),
    ).toMatchObject({
      webdavUrl: 'https://cloud.example.com/remote.php/dav/files/docente/',
      requestTimeoutMs: 23000,
    });
  });

  it.each([
    'NEXTCLOUD_WEBDAV_URL',
    'NEXTCLOUD_USERNAME',
    'NEXTCLOUD_APP_PASSWORD',
  ])('rechaza la configuración parcial sin %s', (key) => {
    expect(() => readNextcloudConfig({ ...env, [key]: '' })).toThrow(
      NextcloudConfigError,
    );
  });

  it.each([
    'no-es-una-url',
    'ftp://cloud.example.com/dav/',
    'http://cloud.example.com/dav/',
    'https:cloud.example.com/dav/',
    'https://usuario:secreto@cloud.example.com/dav/',
    'https://usuario@cloud.example.com/dav/',
    'https://cloud.example.com/dav/?token=secreto',
    'https://cloud.example.com/dav/#secreto',
    'https://cloud.example.com/dav/?',
    'https://cloud.example.com/dav/#',
    ' https://cloud.example.com/dav/',
    'https://cloud.example.com/da\nv/',
  ])('rechaza la URL insegura o ambigua %j', (webdavUrl) => {
    expect(() =>
      readNextcloudConfig({ ...env, NEXTCLOUD_WEBDAV_URL: webdavUrl }),
    ).toThrow(NextcloudConfigError);
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'admite HTTP solo en loopback para pruebas: %s',
    (host) => {
      expect(
        readNextcloudConfig({
          ...env,
          NEXTCLOUD_WEBDAV_URL: `http://${host}:8080/dav/`,
        })?.webdavUrl,
      ).toBe(`http://${host}:8080/dav/`);
    },
  );

  it.each(['', '0', '-1', '300001', '1.5', 'abc', 'Infinity', ' 15000 '])(
    'rechaza el timeout inválido %j',
    (timeout) => {
      expect(() =>
        readNextcloudConfig({ ...env, NEXTCLOUD_REQUEST_TIMEOUT_MS: timeout }),
      ).toThrow(NextcloudConfigError);
    },
  );

  it.each([' ', ' docente ', 'docente:otro', 'docente\n'])(
    'rechaza el usuario inválido %j',
    (username) => {
      expect(() =>
        readNextcloudConfig({ ...env, NEXTCLOUD_USERNAME: username }),
      ).toThrow(NextcloudConfigError);
    },
  );

  it.each([' ', 'secreto\n'])(
    'rechaza contraseñas vacías o con controles %j',
    (appPassword) => {
      expect(() =>
        readNextcloudConfig({ ...env, NEXTCLOUD_APP_PASSWORD: appPassword }),
      ).toThrow(NextcloudConfigError);
    },
  );

  it('valida configuraciones directas sin incluir sus valores en los errores', () => {
    try {
      validateNextcloudConfig({
        webdavUrl: 'https://usuario:secreto@cloud.example.com/',
        username: 'usuario',
        appPassword: 'otro-secreto',
        requestTimeoutMs: 15000,
      });
      expect.fail('Debería rechazar la URL con credenciales.');
    } catch (error) {
      expect(error).toBeInstanceOf(NextcloudConfigError);
      expect(String(error)).not.toContain('usuario:secreto');
      expect(String(error)).not.toContain('otro-secreto');
      expect(String(error)).not.toContain('cloud.example.com');
    }
    const config = readNextcloudConfig(env)!;
    expect(() =>
      validateNextcloudConfig({ ...config, requestTimeoutMs: NaN }),
    ).toThrow(NextcloudConfigError);
  });
});
