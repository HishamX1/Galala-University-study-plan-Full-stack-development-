import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';

async function parse() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workerData.buffer), { ignoreNodes: ['sheetProtection', 'extLst'] });
  if (workbook.worksheets.length !== 1) throw new Error('Workbook must contain exactly one worksheet');
  if (workbook._externalLinks?.length) throw new Error('External links are not supported');
  const sheet = workbook.worksheets[0];
  const rowCount = sheet.actualRowCount;
  const columnCount = sheet.columnCount;
  if (!rowCount || !columnCount) throw new Error('The workbook has no readable worksheet');
  if (rowCount > 10_000 || columnCount > 100 || rowCount * columnCount > 100_000) throw new Error('Workbook exceeds the supported row or cell limits');
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cell.value ?? '').trim(); });
  if (!headers.slice(1).some(Boolean) || headers.slice(1).some((header) => !header)) throw new Error('Worksheet must have a complete header row');
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const result = {};
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      if (cell.type === ExcelJS.ValueType.formula || cell.value?.formula || cell.hyperlink || cell.note) throw new Error('Formulas, links, and embedded cell content are not supported');
      result[headers[column]] = cell.value ?? '';
    }
    rows.push(result);
  });
  return rows;
}

parse().then((rows) => parentPort.postMessage({ ok: true, rows })).catch((error) => parentPort.postMessage({ ok: false, error: error.message || 'Invalid XLSX file' }));
