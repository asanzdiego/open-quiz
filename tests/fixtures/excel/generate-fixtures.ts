import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const directory = fileURLToPath(new URL('./', import.meta.url));
await mkdir(directory, { recursive: true });

const headers = [
  'Pregunta',
  'Respuesta correcta',
  'Respuesta incorrecta 1',
  'Respuesta incorrecta 2',
  'Respuesta incorrecta 3',
];
const questions = [
  ['¿Cuánto es 2 + 2?', 4, 3, 5, 6],
  [
    '¿Qué planeta se conoce como el planeta rojo?',
    'Marte',
    'Venus',
    'Júpiter',
    'Mercurio',
  ],
];

async function writeFixture(
  name: string,
  fill: (workbook: ExcelJS.Workbook) => void,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date('2000-01-01T00:00:00Z');
  workbook.modified = new Date('2000-01-01T00:00:00Z');
  fill(workbook);
  await workbook.xlsx.writeFile(fileURLToPath(new URL(name, import.meta.url)));
}

await writeFixture('valid-header.xlsx', (workbook) => {
  const sheet = workbook.addWorksheet('Preguntas');
  sheet.addRow(headers);
  sheet.addRows(questions);
});

await writeFixture('valid-no-header.xlsx', (workbook) => {
  workbook.addWorksheet('Cuestionario').addRows(questions);
});

await writeFixture('incomplete-row.xlsx', (workbook) => {
  const sheet = workbook.addWorksheet('Preguntas');
  sheet.addRow(headers);
  sheet.addRow(['¿Cuánto es 2 + 2?', 4, 3, 5]);
});

await writeFixture('ambiguous-header.xlsx', (workbook) => {
  const sheet = workbook.addWorksheet('Preguntas');
  sheet.addRow([
    'Pregunta',
    'Respuesta correcta',
    'Respuesta incorrecta 1',
    'Respuesta incorrecta 2',
    'Otra respuesta',
  ]);
  sheet.addRows(questions);
});

await writeFixture('multiple-sheets.xlsx', (workbook) => {
  workbook
    .addWorksheet('Portada')
    .addRow(['¿Primera hoja?', 'Primera', 'Segunda', 'Tercera', 'Cuarta']);
  const sheet = workbook.addWorksheet('Preguntas');
  sheet.addRow(headers);
  sheet.addRows(questions);
  workbook
    .addWorksheet('P01')
    .addRow([
      'Nick',
      'Acertada',
      'Tiempo',
      'Puntos pregunta',
      'Puntos totales',
    ]);
});

await writeFixture('formula.xlsx', (workbook) => {
  const sheet = workbook.addWorksheet('Preguntas');
  sheet.addRow(headers);
  sheet.addRow(['¿Cuánto es 2 + 2?', { formula: '2+2', result: 4 }, 3, 5, 6]);
});
