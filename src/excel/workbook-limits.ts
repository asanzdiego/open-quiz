import { inflateRawSync } from 'node:zlib';
import { ExcelImportError } from './excel-import-error.ts';

export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
export const MAX_EXPANDED_WORKBOOK_BYTES = 50 * 1024 * 1024;
export const MAX_QUESTIONS = 500;
export const MAX_QUESTION_TEXT_LENGTH = 2000;
export const MAX_ANSWER_TEXT_LENGTH = 1000;
const MAX_ZIP_ENTRIES = 2000;

function invalid(): never {
  throw new ExcelImportError(
    'INVALID_WORKBOOK',
    'El fichero no es un libro XLSX válido o utiliza un formato ZIP no admitido.',
  );
}
function tooLarge(): never {
  throw new ExcelImportError(
    'WORKBOOK_TOO_LARGE',
    'El XLSX supera los límites de tamaño: 10 MiB comprimidos, 50 MiB descomprimidos o 2000 entradas ZIP.',
  );
}

/** Comprueba tamaños reales antes de entregar el ZIP a ExcelJS, también ante tamaños falsos. */
export function validateWorkbookArchive(data: Buffer): void {
  if (!Buffer.isBuffer(data) || data.length < 22) invalid();
  if (data.length > MAX_WORKBOOK_BYTES) tooLarge();
  let end = -1;
  for (
    let offset = data.length - 22;
    offset >= Math.max(0, data.length - 65557);
    offset -= 1
  ) {
    if (
      data.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + data.readUInt16LE(offset + 20) === data.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) invalid();
  const entries = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryOffset = data.readUInt32LE(end + 16);
  // No admitir ZIP64 ni archivos divididos para un libro pequeño del MVP.
  if (
    data.readUInt16LE(end + 4) !== 0 ||
    data.readUInt16LE(end + 6) !== 0 ||
    entries === 0xffff ||
    data.readUInt16LE(end + 8) !== entries ||
    directoryOffset + directorySize !== end
  )
    invalid();
  if (entries > MAX_ZIP_ENTRIES) tooLarge();
  let offset = directoryOffset;
  let expandedBytes = 0;
  const names = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50)
      invalid();
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const expanded = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const entryEnd =
      offset +
      46 +
      nameLength +
      data.readUInt16LE(offset + 30) +
      data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    if (
      entryEnd > end ||
      (flags & 1) !== 0 ||
      ![0, 8].includes(method) ||
      data.readUInt16LE(offset + 34) !== 0 ||
      local + 30 > directoryOffset
    )
      invalid();
    const name = data.subarray(offset + 46, offset + 46 + nameLength);
    const decoded = name.toString('utf8');
    if (names.has(decoded)) invalid();
    names.add(decoded);
    expandedBytes += expanded;
    if (expandedBytes > MAX_EXPANDED_WORKBOOK_BYTES) tooLarge();
    if (
      data.readUInt32LE(local) !== 0x04034b50 ||
      data.readUInt16LE(local + 8) !== method ||
      data.readUInt16LE(local + 6) !== flags
    )
      invalid();
    const localNameLength = data.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength + data.readUInt16LE(local + 28);
    if (
      start + compressed > directoryOffset ||
      !name.equals(data.subarray(local + 30, local + 30 + localNameLength))
    )
      invalid();
    const compressedData = data.subarray(start, start + compressed);
    try {
      const actualLength =
        method === 0
          ? compressedData.length
          : inflateRawSync(compressedData, {
              maxOutputLength: Math.max(1, expanded),
            }).length;
      if (actualLength !== expanded) invalid();
    } catch {
      invalid();
    }
    offset = entryEnd;
  }
  if (offset !== end) invalid();
}
