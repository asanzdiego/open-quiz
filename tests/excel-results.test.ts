import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { RoundResult } from '../src/domain/question/round.ts';
import {
  writeQuestionResults,
  RESULT_HEADERS,
} from '../src/excel/write-question-results.ts';

const fixture = (name = 'valid-header.xlsx') =>
  readFile(new URL(`./fixtures/excel/${name}`, import.meta.url));
async function open(data: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(data).buffer);
  return workbook;
}
const result: RoundResult = {
  questionId: 'question-1',
  questionNumber: 1,
  correctOptionId: 'option-1',
  correctAnswer: '4',
  persistence: { status: 'pending', error: null },
  participants: [
    {
      participantId: 'ana',
      nick: 'Ana',
      answered: true,
      isCorrect: true,
      elapsedMs: 5123,
      points: 744,
      totalPoints: 1744,
    },
    {
      participantId: 'luis',
      nick: 'Luis',
      answered: true,
      isCorrect: false,
      elapsedMs: 2500,
      points: 0,
      totalPoints: 250,
    },
    {
      participantId: 'maria',
      nick: 'María',
      answered: false,
      isCorrect: false,
      elapsedMs: 20000,
      points: 0,
      totalPoints: 0,
    },
  ],
};

describe('Escritura de resultados XLSX', () => {
  it('crea P01 con cinco columnas y todos los participantes, incluidos quienes no responden', async () => {
    const input = await fixture();
    const original = Buffer.from(input);
    const workbook = await open(await writeQuestionResults(input, result));
    const sheet = workbook.getWorksheet('P01')!;
    expect(sheet.columnCount).toBe(5);
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(1).values).toEqual([undefined, ...RESULT_HEADERS]);
    expect(sheet.getRow(2).values).toEqual([
      undefined,
      'Ana',
      'Sí',
      5123,
      744,
      1744,
    ]);
    expect(sheet.getRow(3).values).toEqual([
      undefined,
      'Luis',
      'No',
      2500,
      0,
      250,
    ]);
    expect(sheet.getRow(4).values).toEqual([
      undefined,
      'María',
      'No',
      20000,
      0,
      0,
    ]);
    expect(sheet.getCell('C2').numFmt).toBe('0');
    expect(workbook.getWorksheet('Preguntas')?.getRow(2).values).toEqual(
      (await open(input)).getWorksheet('Preguntas')?.getRow(2).values,
    );
    expect(input).toEqual(original);
  });

  it('conserva hojas, fórmulas y formato existentes y añade P02 tras P01', async () => {
    const current = await open(
      await writeQuestionResults(await fixture(), result),
    );
    const notes = current.addWorksheet('Notas');
    notes.getCell('A1').value = 'Cambio externo';
    notes.getCell('B1').value = { formula: '1+1', result: 2 };
    notes.getCell('A1').font = { bold: true };
    const updated = await open(
      await writeQuestionResults(
        Buffer.from(await current.xlsx.writeBuffer()),
        { ...result, questionNumber: 2 },
      ),
    );
    expect(updated.worksheets.map((sheet) => sheet.name)).toEqual([
      'Preguntas',
      'P01',
      'Notas',
      'P02',
    ]);
    expect(updated.getWorksheet('Notas')?.getCell('A1').value).toBe(
      'Cambio externo',
    );
    expect(updated.getWorksheet('Notas')?.getCell('A1').font.bold).toBe(true);
    expect(updated.getWorksheet('Notas')?.getCell('B1').value).toEqual({
      formula: '1+1',
      result: 2,
    });
    expect(updated.getWorksheet('P01')?.getRow(2).values).toEqual([
      undefined,
      'Ana',
      'Sí',
      5123,
      744,
      1744,
    ]);
  });

  it('rechaza P01 existente sin sobrescribirlo', async () => {
    const input = await fixture('multiple-sheets.xlsx');
    await expect(writeQuestionResults(input, result)).rejects.toMatchObject({
      code: 'RESULT_SHEET_EXISTS',
    });
    expect((await open(input)).getWorksheet('P01')?.rowCount).toBe(1);
  });

  it('detecta también un nombre p01 en minúsculas', async () => {
    const workbook = await open(await fixture());
    workbook.addWorksheet('p01').getCell('A1').value = 'Conservar';
    await expect(
      writeQuestionResults(
        Buffer.from(await workbook.xlsx.writeBuffer()),
        result,
      ),
    ).rejects.toMatchObject({ code: 'RESULT_SHEET_EXISTS' });
  });

  it('admite una ronda sin participantes y nicks como texto literal', async () => {
    const empty = await open(
      await writeQuestionResults(await fixture(), {
        ...result,
        participants: [],
      }),
    );
    expect(empty.getWorksheet('P01')?.rowCount).toBe(1);
    const formulaNick = '=HYPERLINK("https://example.com")';
    const workbook = await open(
      await writeQuestionResults(await fixture(), {
        ...result,
        questionNumber: 100,
        participants: [{ ...result.participants[0]!, nick: formulaNick }],
      }),
    );
    const cell = workbook.getWorksheet('P100')!.getCell('A2');
    expect(cell.value).toBe(formulaNick);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
  });

  it('rechaza un XLSX dañado y números de pregunta inválidos', async () => {
    await expect(
      writeQuestionResults(Buffer.from('no xlsx'), result),
    ).rejects.toMatchObject({ code: 'INVALID_WORKBOOK' });
    for (const questionNumber of [0, -1, 1.5, NaN])
      await expect(
        writeQuestionResults(await fixture(), { ...result, questionNumber }),
      ).rejects.toThrow(RangeError);
  });
});
