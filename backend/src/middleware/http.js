export function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
}

export async function parseBody(req, maxBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
}

export function download(res, payload) {
  res.writeHead(200, {
    'Content-Type': payload.mimeType,
    'Content-Disposition': `attachment; filename="${payload.filename.replaceAll('"', '')}"`,
    'Cache-Control': 'no-store'
  });
  res.end(payload.content);
}
