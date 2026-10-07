import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../src/services/session-service.ts';
import { WorkbookResultsService } from '../src/services/workbook-results-service.ts';
import { WorkbookStorageError } from '../src/services/workbook-storage-error.ts';
import { gameWorkbook } from './helpers/game-fixture.ts';
import { InMemoryWorkbookStorage } from './helpers/in-memory-workbook-storage.ts';

describe('Guardado de resultados y locks', () => {
  let sessions: SessionService;
  let storage: InMemoryWorkbookStorage;
  let service: WorkbookResultsService;
  const onChange = vi.fn();
  beforeEach(async () => {
    onChange.mockClear();
    sessions = new SessionService();
    storage = new InMemoryWorkbookStorage();
    await storage.uploadWorkbook(
      gameWorkbook.reference,
      await readFile(
        new URL('./fixtures/excel/valid-header.xlsx', import.meta.url),
      ),
    );
    service = new WorkbookResultsService(sessions, storage, onChange);
  });
  function closed(reference = gameWorkbook.reference) {
    const session = sessions.createSession({ ...gameWorkbook, reference });
    const ana = sessions.joinSession(
      session.joinCode,
      'Ana',
      `socket-${session.id}`,
    );
    const started = sessions.startGame(session.id, session.teacherToken);
    sessions.submitAnswer(
      session.id,
      ana.id,
      ana.socketId!,
      started.currentRound!.questionId,
      started.currentRound!.correctOptionId,
    );
    return sessions.closeQuestion(session.id, session.teacherToken);
  }
  async function workbook(reference = gameWorkbook.reference) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(
      Uint8Array.from(await storage.downloadWorkbook(reference)).buffer,
    );
    return book;
  }

  it('descarga la versión actual y sube una sola vez, sin repetir un guardado confirmado', async () => {
    const session = closed();
    const remote = await workbook();
    remote.addWorksheet('Notas').getCell('A1').value =
      'Editado después de crear la sesión';
    await storage.uploadWorkbook(
      gameWorkbook.reference,
      Buffer.from(await remote.xlsx.writeBuffer()),
    );
    const download = vi.spyOn(storage, 'downloadWorkbook');
    const upload = vi.spyOn(storage, 'uploadWorkbook');
    expect(await service.saveLatest(session.id)).toMatchObject({
      status: 'saved',
      worksheetName: 'P01',
    });
    await service.saveLatest(session.id);
    expect(download).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.map(([, value]) => value.status)).toEqual([
      'saving',
      'saved',
    ]);
    const book = await workbook();
    expect(book.getWorksheet('Notas')?.getCell('A1').value).toBe(
      'Editado después de crear la sesión',
    );
    expect(book.getWorksheet('P01')?.getCell('A2').value).toBe('Ana');
  });

  it('comparte un único intento para cierres o reintentos simultáneos de la misma sesión', async () => {
    const session = closed();
    const download = vi.spyOn(storage, 'downloadWorkbook');
    const upload = vi.spyOn(storage, 'uploadWorkbook');
    const first = service.saveLatest(session.id);
    const second = service.saveLatest(session.id);
    expect(second).toBe(first);
    expect(
      sessions.getSession(session.id).completedRounds[0]?.persistence.status,
    ).toBe('saving');
    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ status: 'saved' }),
      expect.objectContaining({ status: 'saved' }),
    ]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('conserva puntos ante un conflicto de versión y reintenta con una descarga nueva', async () => {
    const session = closed();
    let version = 1;
    const points = sessions.getGameSnapshot(session.id).ranking[0]!.totalPoints;
    const versionedStorage = {
      downloadWorkbook: storage.downloadWorkbook.bind(storage),
      downloadWorkbookSnapshot: vi.fn(async (reference: string) => ({
        data: await storage.downloadWorkbook(reference),
        version: `"v${version}"`,
      })),
      uploadWorkbook: vi.fn(
        async (
          reference: string,
          data: Buffer,
          options?: { expectedVersion: string },
        ) => {
          expect(options?.expectedVersion).toBe(`"v${version}"`);
          if (version === 1) {
            version += 1;
            throw new WorkbookStorageError('WORKBOOK_CHANGED');
          }
          await storage.uploadWorkbook(reference, data);
        },
      ),
    };
    service = new WorkbookResultsService(sessions, versionedStorage);
    expect(await service.saveLatest(session.id)).toMatchObject({
      status: 'error',
      error: { code: 'WORKBOOK_CHANGED' },
    });
    expect(sessions.getGameSnapshot(session.id).ranking[0]?.totalPoints).toBe(
      points,
    );
    expect(await service.saveLatest(session.id)).toMatchObject({
      status: 'saved',
    });
    expect(versionedStorage.downloadWorkbookSnapshot).toHaveBeenCalledTimes(2);
    expect((await workbook()).getWorksheet('P01')?.rowCount).toBe(2);
    expect(sessions.getSession(session.id).completedRounds).toHaveLength(1);
    expect(sessions.getGameSnapshot(session.id).ranking[0]?.totalPoints).toBe(
      points,
    );
  });

  it('conserva ranking y resultados al fallar, bloquea avance y final y libera el lock para reintentar', async () => {
    const session = closed();
    const points = sessions.getGameSnapshot(session.id).ranking[0]!.totalPoints;
    const upload = vi
      .spyOn(storage, 'uploadWorkbook')
      .mockRejectedValueOnce(new WorkbookStorageError('UPLOAD_FAILED'));
    expect(await service.saveLatest(session.id)).toMatchObject({
      status: 'error',
      error: { code: 'UPLOAD_FAILED' },
    });
    for (const action of [
      () => sessions.startNextQuestion(session.id, session.teacherToken),
      () => sessions.endGame(session.id, session.teacherToken),
    ])
      expect(action).toThrow(
        expect.objectContaining({ code: 'RESULTS_NOT_SAVED' }),
      );
    expect(sessions.getGameSnapshot(session.id)).toMatchObject({
      state: 'QUESTION_RESULTS',
      ranking: [{ totalPoints: points }],
      workbookSave: { status: 'error' },
    });
    expect(await service.saveLatest(session.id)).toMatchObject({
      status: 'saved',
      error: null,
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(sessions.getSession(session.id).completedRounds).toHaveLength(1);
    expect(sessions.getGameSnapshot(session.id).ranking[0]?.totalPoints).toBe(
      points,
    );
    sessions.startNextQuestion(session.id, session.teacherToken);
    sessions.closeQuestion(session.id, session.teacherToken);
    await service.saveLatest(session.id);
    expect((await workbook()).worksheets.map((sheet) => sheet.name)).toEqual([
      'Preguntas',
      'P01',
      'P02',
    ]);
    expect(sessions.endGame(session.id, session.teacherToken).state).toBe(
      'FINISHED',
    );
  });

  it.each(['download', 'xlsx', 'conflict'] as const)(
    'no sube el libro ante un error de %s y permite reintentar',
    async (failure) => {
      const session = closed();
      const valid = await storage.downloadWorkbook(gameWorkbook.reference);
      let expectedCode: string;
      if (failure === 'download') {
        vi.spyOn(storage, 'downloadWorkbook').mockRejectedValueOnce(
          new WorkbookStorageError('DOWNLOAD_FAILED'),
        );
        expectedCode = 'DOWNLOAD_FAILED';
      } else if (failure === 'xlsx') {
        await storage.uploadWorkbook(
          gameWorkbook.reference,
          Buffer.from('dañado'),
        );
        expectedCode = 'INVALID_WORKBOOK';
      } else {
        await storage.uploadWorkbook(
          gameWorkbook.reference,
          await readFile(
            new URL('./fixtures/excel/multiple-sheets.xlsx', import.meta.url),
          ),
        );
        expectedCode = 'RESULT_SHEET_EXISTS';
      }
      const upload = vi.spyOn(storage, 'uploadWorkbook');
      expect(await service.saveLatest(session.id)).toMatchObject({
        status: 'error',
        error: { code: expectedCode },
      });
      expect(upload).not.toHaveBeenCalled();
      await storage.uploadWorkbook(gameWorkbook.reference, valid);
      expect(await service.saveLatest(session.id)).toMatchObject({
        status: 'saved',
      });
    },
  );

  it('serializa sesiones sobre la misma ruta y evita perder resultados por sobrescritura', async () => {
    const first = closed();
    const second = closed();
    const upload = vi.spyOn(storage, 'uploadWorkbook');
    const statuses = await Promise.all([
      service.saveLatest(first.id),
      service.saveLatest(second.id),
    ]);
    expect(statuses.map((status) => status.status)).toEqual(['saved', 'error']);
    expect(statuses[1]?.error?.code).toBe('RESULT_SHEET_EXISTS');
    expect(upload).toHaveBeenCalledTimes(1);
    expect((await workbook()).getWorksheet('P01')?.rowCount).toBe(2);
  });

  it('permite escrituras simultáneas en libros distintos', async () => {
    const other = 'Quiz/otro.xlsx';
    await storage.uploadWorkbook(
      other,
      await storage.downloadWorkbook(gameWorkbook.reference),
    );
    const first = closed();
    const second = closed(other);
    const originalDownload = storage.downloadWorkbook.bind(storage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(storage, 'downloadWorkbook').mockImplementation(
      async (reference) => {
        if (reference === gameWorkbook.reference) await gate;
        return originalDownload(reference);
      },
    );
    const pending = service.saveLatest(first.id);
    expect(await service.saveLatest(second.id)).toMatchObject({
      status: 'saved',
    });
    expect(
      sessions.getSession(first.id).completedRounds[0]?.persistence.status,
    ).toBe('saving');
    release();
    expect(await pending).toMatchObject({ status: 'saved' });
  });

  it('no expone detalles de errores inesperados ni estado de escritura a alumnos', async () => {
    const session = closed();
    vi.spyOn(storage, 'uploadWorkbook').mockRejectedValueOnce(
      new Error(
        'Authorization: secret-password https://user:secret@cloud.example.com',
      ),
    );
    const status = await service.saveLatest(session.id);
    expect(status.error?.code).toBe('RESULT_SAVE_FAILED');
    expect(JSON.stringify(onChange.mock.calls)).not.toMatch(
      /secret|Authorization|cloud.example/,
    );
    const participant = [...session.participants.values()][0]!;
    expect(
      sessions.getGameSnapshot(session.id, participant.id).workbookSave,
    ).toBeNull();
  });

  it('bloquea el avance mientras se guarda y no elimina una sesión con E/S pendiente', async () => {
    let now = 1000;
    sessions = new SessionService(undefined, { now: () => now });
    service = new WorkbookResultsService(sessions, storage);
    const session = closed();
    const pending = service.saveLatest(session.id);
    expect(() =>
      sessions.startNextQuestion(session.id, session.teacherToken),
    ).toThrow(expect.objectContaining({ code: 'RESULTS_NOT_SAVED' }));
    now += 2000;
    expect(
      sessions.cleanupExpired({
        sessionTtlMs: 1000,
        finishedSessionTtlMs: 1000,
      }),
    ).toBe(0);
    await pending;
    now += 1000;
    expect(
      sessions.cleanupExpired({
        sessionTtlMs: 1000,
        finishedSessionTtlMs: 1000,
      }),
    ).toBe(1);
  });

  it('devuelve un error seguro sin almacenamiento y rechaza guardar sin resultados', async () => {
    const session = closed();
    service = new WorkbookResultsService(sessions, undefined);
    expect(await service.saveLatest(session.id)).toMatchObject({
      status: 'error',
      error: { code: 'STORAGE_NOT_CONFIGURED' },
    });
    const lobby = sessions.createSession(gameWorkbook);
    expect(() => service.saveLatest(lobby.id)).toThrow(
      expect.objectContaining({ code: 'RESULT_NOT_FOUND' }),
    );
  });
});
