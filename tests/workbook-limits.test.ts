import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { importQuestions } from '../src/excel/import-questions.ts';
import { writeQuestionResults } from '../src/excel/write-question-results.ts';
import {
  validateWorkbookArchive,
  MAX_WORKBOOK_BYTES,
  MAX_EXPANDED_WORKBOOK_BYTES,
} from '../src/excel/workbook-limits.ts';
import { SessionService } from '../src/services/session-service.ts';
import { gameWorkbook } from './helpers/game-fixture.ts';

const fixture = () =>
  readFile(new URL('./fixtures/excel/valid-header.xlsx', import.meta.url));
function centralOffset(data: Buffer) {
  return data.readUInt32LE(data.length - 6);
}

describe('Límites de libros XLSX', () => {
  it('rechaza un fichero demasiado grande antes de abrirlo', async () => {
    await expect(
      importQuestions(Buffer.alloc(MAX_WORKBOOK_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'WORKBOOK_TOO_LARGE' });
  });

  it('rechaza tamaños descomprimidos excesivos antes de abrir ExcelJS', async () => {
    const data = await fixture();
    data.writeUInt32LE(
      MAX_EXPANDED_WORKBOOK_BYTES + 1,
      centralOffset(data) + 24,
    );
    expect(() => validateWorkbookArchive(data)).toThrow(
      expect.objectContaining({ code: 'WORKBOOK_TOO_LARGE' }),
    );
  });

  it('limita la descompresión real aunque el ZIP declare un tamaño pequeño', async () => {
    const data = await fixture();
    data.writeUInt32LE(1, centralOffset(data) + 24);
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'INVALID_WORKBOOK',
    });
  });

  it('protege también el libro descargado al guardar y conserva el resultado', async () => {
    const sessions = new SessionService();
    const session = sessions.createSession(gameWorkbook);
    sessions.startGame(session.id, session.teacherToken);
    const closed = sessions.closeQuestion(session.id, session.teacherToken);
    await expect(
      writeQuestionResults(
        Buffer.alloc(MAX_WORKBOOK_BYTES + 1),
        closed.completedRounds[0]!,
      ),
    ).rejects.toMatchObject({ code: 'WORKBOOK_TOO_LARGE' });
    expect(sessions.getSession(session.id).completedRounds).toHaveLength(1);
  });

  it.each(['questions', 'question', 'answer'])(
    'rechaza un exceso de %s',
    async (limit) => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('Preguntas');
      for (let count = 0; count < (limit === 'questions' ? 501 : 1); count += 1)
        sheet.addRow([
          limit === 'question' ? 'x'.repeat(2001) : '¿Qué opción?',
          limit === 'answer' ? 'x'.repeat(1001) : 'Correcta',
          'Uno',
          'Dos',
          'Tres',
        ]);
      await expect(
        importQuestions(Buffer.from(await book.xlsx.writeBuffer())),
      ).rejects.toMatchObject({ code: 'QUIZ_LIMIT_EXCEEDED' });
    },
  );
});
