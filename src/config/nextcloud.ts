export interface NextcloudConfig {
  webdavUrl: string;
  username: string;
  appPassword: string;
  requestTimeoutMs: number;
}

export class NextcloudConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NextcloudConfigError';
  }
}

/** Valida también configuraciones creadas desde código. Los errores nunca incluyen valores. */
export function validateNextcloudConfig(
  config: NextcloudConfig,
): NextcloudConfig {
  let url: URL;
  try {
    url = new URL(config.webdavUrl);
  } catch {
    throw new NextcloudConfigError(
      'NEXTCLOUD_WEBDAV_URL debe ser una URL WebDAV válida.',
    );
  }

  const localHttp =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !/^https?:\/\//u.test(config.webdavUrl) ||
    config.webdavUrl !== config.webdavUrl.trim() ||
    /\p{Cc}/u.test(config.webdavUrl) ||
    (url.protocol !== 'https:' && !localHttp) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    config.webdavUrl.includes('?') ||
    config.webdavUrl.includes('#')
  ) {
    throw new NextcloudConfigError(
      'NEXTCLOUD_WEBDAV_URL debe usar HTTPS, sin credenciales, parámetros ni fragmentos. HTTP solo se admite en localhost.',
    );
  }

  if (
    typeof config.username !== 'string' ||
    config.username.trim() === '' ||
    config.username !== config.username.trim() ||
    /[:\p{Cc}]/u.test(config.username)
  ) {
    throw new NextcloudConfigError(
      'NEXTCLOUD_USERNAME debe contener un usuario válido, sin dos puntos ni caracteres de control.',
    );
  }
  if (
    typeof config.appPassword !== 'string' ||
    config.appPassword.trim() === '' ||
    /\p{Cc}/u.test(config.appPassword)
  ) {
    throw new NextcloudConfigError(
      'NEXTCLOUD_APP_PASSWORD debe contener una contraseña de aplicación válida.',
    );
  }
  if (
    !Number.isInteger(config.requestTimeoutMs) ||
    config.requestTimeoutMs < 1 ||
    config.requestTimeoutMs > 300_000
  ) {
    throw new NextcloudConfigError(
      'NEXTCLOUD_REQUEST_TIMEOUT_MS debe ser un entero entre 1 y 300000.',
    );
  }

  // No reconstruimos la ruta: el usuario puede copiar la URL WebDAV que ofrece Nextcloud.
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return { ...config, webdavUrl: url.href };
}

/** Sin Nextcloud el servidor arranca, pero la creación de partidas devuelve un error seguro. */
export function readNextcloudConfig(
  env: NodeJS.ProcessEnv = process.env,
): NextcloudConfig | undefined {
  const values = [
    env.NEXTCLOUD_WEBDAV_URL,
    env.NEXTCLOUD_USERNAME,
    env.NEXTCLOUD_APP_PASSWORD,
  ];
  if (values.every((value) => value === undefined || value === ''))
    return undefined;
  if (values.some((value) => value === undefined || value === '')) {
    throw new NextcloudConfigError(
      'Configura conjuntamente NEXTCLOUD_WEBDAV_URL, NEXTCLOUD_USERNAME y NEXTCLOUD_APP_PASSWORD en el servidor.',
    );
  }

  const rawTimeout = env.NEXTCLOUD_REQUEST_TIMEOUT_MS ?? '15000';
  if (!/^\d+$/u.test(rawTimeout)) {
    throw new NextcloudConfigError(
      'NEXTCLOUD_REQUEST_TIMEOUT_MS debe ser un entero entre 1 y 300000.',
    );
  }

  return validateNextcloudConfig({
    webdavUrl: env.NEXTCLOUD_WEBDAV_URL!,
    username: env.NEXTCLOUD_USERNAME!,
    appPassword: env.NEXTCLOUD_APP_PASSWORD!,
    requestTimeoutMs: Number(rawTimeout),
  });
}
