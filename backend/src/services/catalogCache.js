export class CatalogRevisionChangedError extends Error {
  constructor() {
    super('Catalog revision changed while its cached snapshot was being built.');
    this.name = 'CatalogRevisionChangedError';
    this.code = 'CATALOG_REVISION_CHANGED_DURING_FILL';
  }
}

function cloneCatalog(value) {
  return structuredClone(value);
}

export function createRevisionedCatalogCache({
  readRevision,
  buildCatalog,
  now = Date.now,
  ttlMs = 5 * 60_000,
  maxEntries = 8,
  maxRevisionRetries = 3
}) {
  if (typeof readRevision !== 'function' || typeof buildCatalog !== 'function') {
    throw new TypeError('Catalog cache requires readRevision and buildCatalog functions.');
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxEntries) || maxEntries < 1
    || !Number.isInteger(maxRevisionRetries) || maxRevisionRetries < 1) {
    throw new TypeError('Catalog cache limits are invalid.');
  }

  const entries = new Map();
  const fills = new Map();

  function removeExpired(time) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(key);
    }
  }

  function store(key, payload, time) {
    entries.delete(key);
    entries.set(key, { payload: cloneCatalog(payload), expiresAt: time + ttlMs });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  async function getCatalog(audience = 'student') {
    if (audience !== 'student' && audience !== 'admin') throw new TypeError('Unsupported catalog audience.');

    for (let attempt = 0; attempt < maxRevisionRetries; attempt += 1) {
      const revision = String(await readRevision());
      const key = `${revision}:${audience}`;
      const currentTime = now();
      removeExpired(currentTime);
      const cached = entries.get(key);
      if (cached && cached.expiresAt > currentTime) {
        entries.delete(key);
        entries.set(key, cached);
        return cloneCatalog(cached.payload);
      }

      let fill = fills.get(key);
      if (!fill) {
        fill = (async () => {
          const payload = await buildCatalog(audience);
          const committedRevision = String(await readRevision());
          if (committedRevision !== revision) throw new CatalogRevisionChangedError();
          store(key, payload, now());
          return payload;
        })();
        fills.set(key, fill);
        const clearFill = () => { if (fills.get(key) === fill) fills.delete(key); };
        fill.then(clearFill, clearFill);
      }

      try {
        return cloneCatalog(await fill);
      } catch (error) {
        if (error?.code !== 'CATALOG_REVISION_CHANGED_DURING_FILL') throw error;
      }
    }

    throw new CatalogRevisionChangedError();
  }

  function clear() {
    entries.clear();
    fills.clear();
  }

  return { getCatalog, clear };
}
