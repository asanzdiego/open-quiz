import { readFile } from 'node:fs/promises';
import ExcelJS, { type CellValue, type Worksheet } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ExcelImportError } from '../src/excel/excel-import-error.ts';
import { importQuestions } from '../src/excel/import-questions.ts';

const headers = [
  'Pregunta',
  'Respuesta correcta',
  'Respuesta incorrecta 1',
  'Respuesta incorrecta 2',
  'Respuesta incorrecta 3',
];
const validRow = ['¿Cuánto es 2 + 2?', 4, 3, 5, 6];

async function fixture(name: string): Promise<Buffer> {
  return readFile(new URL(`./fixtures/excel/${name}`, import.meta.url));
}

async function workbookBuffer(
  fill: (sheet: Worksheet, workbook: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Preguntas');
  fill(sheet, workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('Importación de preguntas XLSX', () => {
  it('lee un fixture con cabecera y conserva el orden de preguntas y respuestas', async () => {
    const result = await importQuestions(await fixture('valid-header.xlsx'));
    expect(result.worksheetName).toBe('Preguntas');
    expect(result.hasHeader).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({
      text: '¿Cuánto es 2 + 2?',
      correctAnswer: '4',
      incorrectAnswers: ['3', '5', '6'],
    });
    expect(result.questions[1]).toMatchObject({
      text: '¿Qué planeta se conoce como el planeta rojo?',
      correctAnswer: 'Marte',
      incorrectAnswers: ['Venus', 'Júpiter', 'Mercurio'],
    });
    expect(result.questions[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.questions[0]?.id).not.toBe(result.questions[1]?.id);
  });

  it('detecta la ausencia de cabecera sin descartar la primera pregunta', async () => {
    const result = await importQuestions(await fixture('valid-no-header.xlsx'));
    expect(result.hasHeader).toBe(false);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]?.text).toBe('¿Cuánto es 2 + 2?');
  });

  it('usa la primera hoja aunque exista otra llamada Preguntas', async () => {
    const result = await importQuestions(await fixture('multiple-sheets.xlsx'));
    expect(result.worksheetName).toBe('Portada');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.correctAnswer).toBe('Primera');
  });

  it('permite seleccionar explícitamente la hoja Preguntas', async () => {
    const result = await importQuestions(
      await fixture('multiple-sheets.xlsx'),
      { worksheetName: 'Preguntas' },
    );
    expect(result.worksheetName).toBe('Preguntas');
    expect(result.questions).toHaveLength(2);
  });

  it('rechaza una hoja solicitada que no existe', async () => {
    await expect(
      importQuestions(await fixture('multiple-sheets.xlsx'), {
        worksheetName: 'Inexistente',
      }),
    ).rejects.toMatchObject({ code: 'WORKSHEET_NOT_FOUND' });
  });

  it('no busca silenciosamente otra hoja cuando la primera está vacía', async () => {
    const data = await workbookBuffer((_sheet, workbook) =>
      workbook.addWorksheet('Otra').addRow(validRow),
    );
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'EMPTY_QUIZ',
      worksheetName: 'Preguntas',
    });
  });

  it('normaliza mayúsculas y espacios para detectar la cabecera', async () => {
    const data = await workbookBuffer((sheet) => {
      sheet.addRow([
        '  PREGUNTA ',
        'RESPUESTA   CORRECTA',
        'Respuesta incorrecta 1 ',
        ' respuesta incorrecta 2',
        'RESPUESTA INCORRECTA 3',
      ]);
      sheet.addRow(validRow);
    });
    expect((await importQuestions(data)).hasHeader).toBe(true);
  });

  it('rechaza la cabecera ambigua del fixture con un error comprensible', async () => {
    await expect(
      importQuestions(await fixture('ambiguous-header.xlsx')),
    ).rejects.toMatchObject({
      code: 'AMBIGUOUS_HEADER',
      cell: 'A1',
      worksheetName: 'Preguntas',
    });
  });

  it('permite confirmar explícitamente una cabecera personalizada', async () => {
    const result = await importQuestions(
      await fixture('ambiguous-header.xlsx'),
      { headerMode: 'present' },
    );
    expect(result.hasHeader).toBe(true);
    expect(result.questions).toHaveLength(2);
  });

  it('permite confirmar que una fila parecida a una cabecera es una pregunta', async () => {
    const data = await workbookBuffer((sheet) =>
      sheet.addRow(['Pregunta', 'Uno', 'Dos', 'Tres', 'Cuatro']),
    );
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'AMBIGUOUS_HEADER',
    });
    const result = await importQuestions(data, { headerMode: 'absent' });
    expect(result.hasHeader).toBe(false);
    expect(result.questions[0]?.text).toBe('Pregunta');
  });

  it.each(['auto', 'present'] as const)(
    'rechaza una cabecera repetida entre preguntas en modo %s',
    async (headerMode) => {
      const data = await workbookBuffer((sheet) => {
        sheet.addRow(headers);
        sheet.addRow(validRow);
        sheet.addRow(headers);
      });
      await expect(importQuestions(data, { headerMode })).rejects.toMatchObject(
        {
          code: 'AMBIGUOUS_HEADER',
          cell: 'A3',
        },
      );
    },
  );

  it('ignora filas completamente vacías y celdas con solo formato o espacios', async () => {
    const data = await workbookBuffer((sheet) => {
      sheet.addRow([' ', null, '', ' ', null]);
      sheet.addRow(headers);
      sheet.addRow([]);
      sheet.addRow(validRow);
      sheet.getCell('A10').font = { bold: true };
      sheet.getCell('F4').font = { bold: true };
    });
    const result = await importQuestions(data);
    expect(result.hasHeader).toBe(true);
    expect(result.questions).toHaveLength(1);
  });

  it('rechaza la fila incompleta del fixture sin devolver un cuestionario parcial', async () => {
    await expect(
      importQuestions(await fixture('incomplete-row.xlsx')),
    ).rejects.toMatchObject({
      code: 'INVALID_ROW',
      cell: 'E2',
      worksheetName: 'Preguntas',
    });
  });

  it.each(['A1', 'B1', 'C1', 'D1', 'E1'])(
    'rechaza una celda requerida vacía en %s',
    async (address) => {
      const data = await workbookBuffer((sheet) => {
        sheet.addRow(validRow);
        sheet.getCell(address).value = '   ';
      });
      await expect(importQuestions(data)).rejects.toMatchObject({
        code: 'INVALID_ROW',
        cell: address,
      });
    },
  );

  it('rechaza un dato adicional en la sexta columna', async () => {
    const data = await workbookBuffer((sheet) =>
      sheet.addRow([...validRow, 'Respuesta extra']),
    );
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'INVALID_ROW',
      cell: 'F1',
    });
  });

  it('rechaza una fila con contenido solo fuera de A–E', async () => {
    const data = await workbookBuffer((sheet) => {
      sheet.getCell('F3').value = 'Dato inesperado';
    });
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'INVALID_ROW',
      cell: 'F3',
    });
  });

  it('rechaza respuestas repetidas después de recortar y normalizar el texto', async () => {
    const data = await workbookBuffer((sheet) =>
      sheet.addRow([
        '¿Idioma?',
        'Español',
        ' Espan\u0303ol ',
        'Inglés',
        'Francés',
      ]),
    );
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'INVALID_ROW',
      cell: 'C1',
    });
  });

  it('permite respuestas que se diferencian por mayúsculas', async () => {
    const data = await workbookBuffer((sheet) =>
      sheet.addRow(['¿Letra mayúscula?', 'A', 'a', 'b', 'c']),
    );
    expect(
      (await importQuestions(data)).questions[0]?.incorrectAnswers,
    ).toEqual(['a', 'b', 'c']);
  });

  it('no utiliza el resultado almacenado de una fórmula como respuesta', async () => {
    await expect(
      importQuestions(await fixture('formula.xlsx')),
    ).rejects.toMatchObject({ code: 'FORMULA_NOT_SUPPORTED', cell: 'B2' });
  });

  it.each(['A1', 'C1', 'D1', 'E1'])(
    'rechaza fórmulas también en %s',
    async (address) => {
      const data = await workbookBuffer((sheet) => {
        sheet.addRow(validRow);
        sheet.getCell(address).value = { formula: '2+2', result: 4 };
      });
      await expect(importQuestions(data)).rejects.toMatchObject({
        code: 'FORMULA_NOT_SUPPORTED',
        cell: address,
      });
    },
  );

  it('convierte números, incluido cero, y texto con formato a texto de dominio', async () => {
    const data = await workbookBuffer((sheet) =>
      sheet.addRow([
        { richText: [{ text: ' ¿Cuánto es ' }, { text: '0 + 0? ' }] },
        0,
        -1,
        2.5,
        { richText: [{ text: ' Otra ' }, { text: 'respuesta ' }] },
      ]),
    );
    expect((await importQuestions(data)).questions[0]).toMatchObject({
      text: '¿Cuánto es 0 + 0?',
      correctAnswer: '0',
      incorrectAnswers: ['-1', '2.5', 'Otra respuesta'],
    });
  });

  it.each<CellValue>([
    new Date('2026-01-01T00:00:00Z'),
    true,
    { text: 'Enlace', hyperlink: 'https://example.com' },
    { error: '#DIV/0!' },
    NaN,
  ])('rechaza valores de celda no admitidos: %j', async (value) => {
    const data = await workbookBuffer((sheet) => {
      sheet.addRow(validRow);
      sheet.getCell('B1').value = value;
    });
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CELL',
      cell: 'B1',
    });
  });

  it('rechaza celdas combinadas en los datos de una pregunta', async () => {
    const data = await workbookBuffer((sheet) => {
      sheet.addRow(validRow);
      sheet.mergeCells('B1:C1');
    });
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'UNSUPPORTED_LAYOUT',
      cell: 'B1',
    });
  });

  it.each(['drawing', 'background'])(
    'rechaza imágenes de tipo %s en la hoja seleccionada',
    async (kind) => {
      const data = await workbookBuffer((sheet, workbook) => {
        sheet.addRow(validRow);
        const imageId = workbook.addImage({
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8L8AAAAASUVORK5CYII=',
          extension: 'png',
        });
        if (kind === 'background') sheet.addBackgroundImage(imageId);
        else sheet.addImage(imageId, 'A1:B2');
      });
      await expect(importQuestions(data)).rejects.toMatchObject({
        code: 'UNSUPPORTED_LAYOUT',
        worksheetName: 'Preguntas',
      });
    },
  );

  it.each(['empty', 'only-header'])(
    'rechaza una hoja sin preguntas: %s',
    async (kind) => {
      const data = await workbookBuffer((sheet) => {
        if (kind === 'only-header') sheet.addRow(headers);
      });
      await expect(importQuestions(data)).rejects.toMatchObject({
        code: 'EMPTY_QUIZ',
      });
    },
  );

  it('rechaza un libro sin hojas', async () => {
    const workbook = new ExcelJS.Workbook();
    await expect(
      importQuestions(Buffer.from(await workbook.xlsx.writeBuffer())),
    ).rejects.toMatchObject({ code: 'INVALID_WORKBOOK' });
  });

  it.each([
    Buffer.alloc(0),
    Buffer.from('Pregunta,Correcta,Incorrecta'),
    Buffer.from('PK\u0003\u0004dañado'),
  ])('rechaza datos que no son un XLSX válido', async (data) => {
    await expect(importQuestions(data)).rejects.toBeInstanceOf(
      ExcelImportError,
    );
    await expect(importQuestions(data)).rejects.toMatchObject({
      code: 'INVALID_WORKBOOK',
    });
  });

  it('lee solo los bytes del Buffer recibido sin modificarlo', async () => {
    const data = await fixture('valid-header.xlsx');
    const surrounding = Buffer.concat([
      Buffer.from('prefijo'),
      data,
      Buffer.from('sufijo'),
    ]);
    const slice = surrounding.subarray(7, 7 + data.length);
    const original = Buffer.from(surrounding);
    expect((await importQuestions(slice)).questions).toHaveLength(2);
    expect(surrounding).toEqual(original);
  });

  it('asigna preguntas independientes a dos importaciones del mismo libro', async () => {
    const data = await fixture('valid-header.xlsx');
    const first = await importQuestions(data);
    const second = await importQuestions(data);
    expect(first.questions[0]?.id).not.toBe(second.questions[0]?.id);
    first.questions.pop();
    expect(second.questions).toHaveLength(2);
  });
});
