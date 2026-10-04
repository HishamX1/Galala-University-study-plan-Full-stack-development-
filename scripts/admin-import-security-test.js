import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { importRows, IMPORT_LIMITS } from '../backend/src/services/adminOpsService.js';
import { preflightXlsxZip } from '../backend/src/services/xlsxImportParser.js';
import { parseXlsxInWorker } from '../backend/src/services/xlsxImportParser.js';

async function encodedWorkbook(configure) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Import');
  configure(workbook, sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

const valid = await encodedWorkbook((_workbook, sheet) => {
  sheet.addRow(['name']);
  sheet.addRow(['Faculty of Engineering']);
});
assert.deepEqual(await importRows({ format: 'xlsx', fileContent: valid }), [{ name: 'Faculty of Engineering' }]);
const validBuffer = Buffer.from(valid, 'base64');
class FailingWorker {
  constructor() { throw new Error('deterministic Worker creation failure'); }
}
for (let attempt = 0; attempt < 3; attempt += 1) {
  await assert.rejects(
    () => parseXlsxInWorker(validBuffer, undefined, FailingWorker),
    /deterministic Worker creation failure/
  );
}
const concurrent = await Promise.allSettled([
  importRows({ format: 'xlsx', fileContent: valid }),
  importRows({ format: 'xlsx', fileContent: valid }),
  importRows({ format: 'xlsx', fileContent: valid })
]);
assert.equal(concurrent.filter((result) => result.status === 'rejected' && /parser is busy/.test(result.reason.message)).length, 1);
assert.equal((await importRows({ format: 'xlsx', fileContent: valid }))[0].name, 'Faculty of Engineering');

await assert.rejects(() => importRows({ format: 'xlsx', fileContent: Buffer.alloc(IMPORT_LIMITS.maxFileBytes + 1).toString('base64') }), /5 MB limit/);
await assert.rejects(() => importRows({ format: 'xlsx', fileContent: Buffer.from('not a workbook').toString('base64') }));

const formula = await encodedWorkbook((_workbook, sheet) => {
  sheet.addRow(['name']);
  sheet.getCell('A2').value = { formula: '1+1', result: 2 };
});
await assert.rejects(() => importRows({ format: 'xlsx', fileContent: formula }), /Formulas/);

const twoSheets = await encodedWorkbook((workbook, sheet) => {
  sheet.addRow(['name']);
  workbook.addWorksheet('Unexpected');
});
await assert.rejects(() => importRows({ format: 'xlsx', fileContent: twoSheets }), /exactly one worksheet/);

const zipBombLike = Buffer.alloc(22 + 46 + 1);
zipBombLike.writeUInt32LE(0x02014b50, 0);
zipBombLike.writeUInt32LE(0x06054b50, 47);
zipBombLike.writeUInt16LE(1, 57);
zipBombLike.writeUInt32LE(46, 59);
zipBombLike.writeUInt32LE(0, 63);
zipBombLike.writeUInt32LE(1, 20);
zipBombLike.writeUInt32LE(1_000, 24);
zipBombLike.writeUInt16LE(1, 28);
zipBombLike[46] = 65;
await assert.rejects(() => Promise.resolve().then(() => preflightXlsxZip(zipBombLike)), /compression ratio/);

console.log('Admin import parser security regression tests passed.');
