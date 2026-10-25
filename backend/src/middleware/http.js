function assertResponseOpen(res) {
  if (res.headersSent || res.writableEnded) {
    const error = new Error('An HTTP response has already been written for this request.');
    error.code = 'ERR_HTTP_RESPONSE_ALREADY_SENT';
    throw error;
  }
}

export function json(res, status, data, extraHeaders = {}) {
  assertResponseOpen(res);
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
  // Returning an explicit handled marker is important to the API dispatcher:
  // several controller branches return json() directly, and `undefined` was
  // previously mistaken for “route not matched,” causing a second 404 write.
  return true;
}

export function writeUnexpectedError(res, requestId) {
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded && typeof res.destroy === 'function') res.destroy();
    return false;
  }
  res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Internal server error', ...(requestId ? { requestId } : {}) }));
  return true;
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
  assertResponseOpen(res);
  res.writeHead(200, {
    'Content-Type': payload.mimeType,
    'Content-Disposition': `attachment; filename="${payload.filename.replaceAll('"', '')}"`,
    'Cache-Control': 'no-store'
  });
  res.end(payload.content);
  return true;
}
