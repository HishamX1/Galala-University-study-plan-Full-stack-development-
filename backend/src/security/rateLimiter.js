const buckets = new Map();

// Deliberately in-process: it is a safe baseline and can be replaced by a shared
// store without changing callers when the application gains multiple instances.
export function allowRequest(key, { limit, windowMs }) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
