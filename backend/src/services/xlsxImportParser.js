import { Worker } from 'node:worker_threads';

export const XLSX_PARSER_LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxZipEntries: 256,
  maxEntryCompressedBytes: 2 * 1024 * 1024,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
  timeoutMs: 10_000,
  maxOldGenerationSizeMb: 128,
  maxConcurrentParsers: 2
});

const EOCD = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;

function u16(buffer, offset) { return buffer.readUInt16LE(offset); }
function u32(buffer, offset) { return buffer.readUInt32LE(offset); }

export function preflightXlsxZip(buffer, limits = XLSX_PARSER_LIMITS) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > limits.maxFileBytes) throw new Error('Import file exceeds the 5 MB limit');
  if (buffer.length < 22) throw new Error('Invalid XLSX ZIP archive');
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (u32(buffer, offset) === EOCD) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) throw new Error('Invalid XLSX ZIP archive');
  const disk = u16(buffer, eocd + 4);
  const centralDisk = u16(buffer, eocd + 6);
  const entries = u16(buffer, eocd + 10);
  const centralSize = u32(buffer, eocd + 12);
  const centralOffset = u32(buffer, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entries > limits.maxZipEntries || entries === 0) throw new Error('Unsupported or oversized XLSX ZIP archive');
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 XLSX archives are not supported');
  if (centralOffset + centralSize > eocd || centralOffset < 0) throw new Error('Invalid XLSX ZIP central directory');

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > eocd || u32(buffer, offset) !== CENTRAL_HEADER) throw new Error('Invalid XLSX ZIP central directory');
    const flags = u16(buffer, offset + 8);
    const compressed = u32(buffer, offset + 20);
    const uncompressed = u32(buffer, offset + 24);
    const nameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const localOffset = u32(buffer, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || localOffset >= buffer.length) throw new Error('Invalid XLSX ZIP entry');
    if ((flags & 1) !== 0) throw new Error('Encrypted XLSX ZIP entries are not supported');
    if (compressed > limits.maxEntryCompressedBytes || uncompressed > limits.maxEntryUncompressedBytes) throw new Error('XLSX ZIP entry exceeds the supported size limit');
    if (uncompressed > 0 && (compressed === 0 || uncompressed / compressed > limits.maxCompressionRatio)) throw new Error('XLSX ZIP entry has an unsafe compression ratio');
    totalUncompressed += uncompressed;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) throw new Error('XLSX ZIP archive exceeds the total uncompressed size limit');
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error('Invalid XLSX ZIP central directory size');
  return { entries, totalUncompressed };
}

export function parseXlsxInWorker(buffer, limits = XLSX_PARSER_LIMITS, WorkerCtor = Worker) {
  preflightXlsxZip(buffer, limits);
  if (activeParsers >= limits.maxConcurrentParsers) return Promise.reject(new Error('XLSX parser is busy; retry the import'));
  activeParsers += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        activeParsers -= 1;
        if (timer) clearTimeout(timer);
        callback(value);
      }
    };
    let worker;
    try {
      worker = new WorkerCtor(new URL('./xlsxImportWorker.js', import.meta.url), {
        workerData: { buffer },
        resourceLimits: { maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb }
      });
    } catch (error) {
      finish(reject, error);
      return;
    }
    timer = setTimeout(() => { worker.terminate(); finish(reject, new Error('XLSX parsing timed out')); }, limits.timeoutMs);
    worker.once('message', (message) => message.ok ? finish(resolve, message.rows) : finish(reject, new Error(message.error || 'Invalid XLSX file')));
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => { if (code !== 0) finish(reject, new Error(`XLSX parser worker exited with code ${code}`)); });
  });
}

let activeParsers = 0;
