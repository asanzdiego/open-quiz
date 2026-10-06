const messages = {
  INVALID_REFERENCE:
    'Indica una ruta de fichero .xlsx válida dentro de Nextcloud.',
  INVALID_DATA: 'El contenido del fichero debe ser un Buffer no vacío.',
  INVALID_RESPONSE: 'Nextcloud no ha devuelto un fichero binario válido.',
  AUTHENTICATION_FAILED:
    'No se ha podido autenticar el acceso a Nextcloud. Revisa el usuario y la contraseña de aplicación en el servidor.',
  PERMISSION_DENIED:
    'No tienes permiso para acceder al fichero de Nextcloud o modificarlo.',
  WORKBOOK_NOT_FOUND: 'El fichero no existe en Nextcloud. Revisa su ruta.',
  CONFLICT:
    'No se ha podido guardar el fichero. Revisa que la carpeta exista en Nextcloud.',
  WORKBOOK_LOCKED:
    'El fichero está bloqueado en Nextcloud. Inténtalo de nuevo más tarde.',
  QUOTA_EXCEEDED:
    'No hay espacio suficiente en Nextcloud para guardar el fichero.',
  REQUEST_TIMEOUT:
    'Nextcloud ha tardado demasiado en responder. Inténtalo de nuevo.',
  DOWNLOAD_FAILED: 'No se ha podido acceder al fichero de Nextcloud.',
  UPLOAD_FAILED: 'No se ha podido guardar el fichero en Nextcloud.',
} as const;

export type WorkbookStorageErrorCode = keyof typeof messages;

/** No conserva el error original: puede contener cabeceras, credenciales o URLs. */
export class WorkbookStorageError extends Error {
  readonly code: WorkbookStorageErrorCode;

  constructor(code: WorkbookStorageErrorCode) {
    super(messages[code]);
    this.name = 'WorkbookStorageError';
    this.code = code;
  }
}
