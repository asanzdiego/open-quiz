import { DomainError } from '../domain/errors.ts';
import type { ResultPersistence } from '../domain/question/round.ts';
import {
  getWorkbookSave,
  type WorkbookSaveSnapshot,
} from '../domain/session/game.ts';
import { ExcelResultsError } from '../excel/excel-results-error.ts';
import { writeQuestionResults } from '../excel/write-question-results.ts';
import type { SessionService } from './session-service.ts';
import { WorkbookStorageError } from './workbook-storage-error.ts';
import type { WorkbookStorage } from './workbook-storage.ts';

function safeSaveError(
  error: unknown,
): NonNullable<ResultPersistence['error']> {
  if (
    error instanceof WorkbookStorageError ||
    error instanceof ExcelResultsError
  )
    return { code: error.code, message: error.message };
  return {
    code: 'RESULT_SAVE_FAILED',
    message:
      'No se han podido guardar los resultados en Nextcloud. Reintenta el guardado.',
  };
}

/** Un único intento compartido por sesión; el lock abarca descargar, editar y subir. */
export class WorkbookResultsService {
  readonly #sessions: SessionService;
  readonly #storage: WorkbookStorage | undefined;
  readonly #onChange: (sessionId: string, status: WorkbookSaveSnapshot) => void;
  readonly #sessionWrites = new Map<string, Promise<WorkbookSaveSnapshot>>();
  readonly #workbookWrites = new Map<string, Promise<void>>();

  constructor(
    sessions: SessionService,
    storage: WorkbookStorage | undefined,
    onChange: (
      sessionId: string,
      status: WorkbookSaveSnapshot,
    ) => void = () => {},
  ) {
    this.#sessions = sessions;
    this.#storage = storage;
    this.#onChange = onChange;
  }

  saveLatest(sessionId: string): Promise<WorkbookSaveSnapshot> {
    const existing = this.#sessionWrites.get(sessionId);
    if (existing) return existing;
    const session = this.#sessions.getSession(sessionId);
    const result = session.completedRounds.at(-1);
    if (!result)
      throw new DomainError(
        'RESULT_NOT_FOUND',
        'No hay resultados para guardar.',
      );
    if (result.persistence.status === 'saved')
      return Promise.resolve(getWorkbookSave(session)!);

    const reference = session.workbookReference;
    const previous = reference
      ? this.#workbookWrites.get(reference)
      : undefined;
    const update = (persistence: ResultPersistence) => {
      this.#sessions.setResultPersistence(
        sessionId,
        result.questionId,
        persistence,
      );
      const snapshot = getWorkbookSave(this.#sessions.getSession(sessionId))!;
      this.#onChange(sessionId, snapshot);
      return snapshot;
    };
    const write = Promise.resolve(previous)
      .then(async () => {
        try {
          if (!reference || !this.#storage)
            throw new WorkbookStorageError('STORAGE_NOT_CONFIGURED');
          const data = await this.#storage.downloadWorkbook(reference);
          const updated = await writeQuestionResults(data, result);
          await this.#storage.uploadWorkbook(reference, updated);
          return update({ status: 'saved', error: null });
        } catch (error) {
          return update({ status: 'error', error: safeSaveError(error) });
        }
      })
      .finally(() => this.#sessionWrites.delete(sessionId));
    this.#sessionWrites.set(sessionId, write);
    if (reference) {
      // Sesiones con la misma ruta comparten el lock y detectan Pxx sin sobrescribir.
      const lock = write
        .then(
          () => {},
          () => {},
        )
        .finally(() => {
          if (this.#workbookWrites.get(reference) === lock)
            this.#workbookWrites.delete(reference);
        });
      this.#workbookWrites.set(reference, lock);
    }
    update({ status: 'saving', error: null });
    return write;
  }
}
