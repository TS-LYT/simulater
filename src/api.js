async function fetchJson(path) {
  const bases = ['', `${window.location.protocol}//${window.location.hostname}:8765`];
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) {
        lastErr = new Error(`${res.status} ${path}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('API unavailable');
}

export function fetchSources() {
  return fetchJson('/api/sources');
}

export function fetchReplayEvents(ids) {
  const q = encodeURIComponent((ids || []).join(','));
  return fetchJson(`/api/replay/events?ids=${q}`);
}
