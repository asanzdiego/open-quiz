import {
  readNextcloudConfig,
  NextcloudConfigError,
} from '../src/config/nextcloud.ts';
import { importQuestions } from '../src/excel/import-questions.ts';
import { ExcelImportError } from '../src/excel/excel-import-error.ts';
import { NextcloudWebDavWorkbookStorage } from '../src/nextcloud/nextcloud-webdav-workbook-storage.ts';
import { WorkbookStorageError } from '../src/services/workbook-storage-error.ts';

async function checkNextcloud() {
  const [reference, option, ...extra] = process.argv.slice(2);
  if (
    !reference ||
    (option !== undefined && option !== '--write-back') ||
    extra.length > 0
  ) {
    console.error(
      'Uso: npm run check:nextcloud -- "Quiz/prueba.xlsx" [--write-back]',
    );
    process.exitCode = 1;
    return;
  }
  const config = readNextcloudConfig();
  if (!config) {
    throw new NextcloudConfigError(
      'Configura NEXTCLOUD_WEBDAV_URL, NEXTCLOUD_USERNAME y NEXTCLOUD_APP_PASSWORD en .env o en el entorno del servidor.',
    );
  }
  const storage = new NextcloudWebDavWorkbookStorage(config);
  const snapshot =
    option === '--write-back'
      ? await storage.downloadWorkbookSnapshot(reference)
      : undefined;
  const data = snapshot?.data ?? (await storage.downloadWorkbook(reference));
  const imported = await importQuestions(data);
  console.info(
    JSON.stringify({
      event: 'nextcloud_download_verified',
      questions: imported.questions.length,
    }),
  );

  if (option === '--write-back') {
    // Prueba manual sobre un fichero de prueba: vuelve a subir exactamente los mismos bytes.
    await storage.uploadWorkbook(reference, data, {
      expectedVersion: snapshot!.version,
    });
    const downloaded = await storage.downloadWorkbook(reference);
    if (!data.equals(downloaded)) {
      throw new WorkbookStorageError('INVALID_RESPONSE');
    }
    console.info(JSON.stringify({ event: 'nextcloud_upload_verified' }));
  }
}

try {
  await checkNextcloud();
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'nextcloud_check_failed',
      message:
        error instanceof WorkbookStorageError ||
        error instanceof ExcelImportError ||
        error instanceof NextcloudConfigError
          ? error.message
          : 'No se ha podido completar la prueba de Nextcloud.',
    }),
  );
  process.exitCode = 1;
}
