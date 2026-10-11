export function createIdFactory(prefixes) {
  const counters = new Map(prefixes.map(prefix => [prefix, 1]));

  function requirePrefix(prefix) {
    if (!counters.has(prefix)) throw new Error(`Unknown identifier prefix: ${prefix}`);
  }

  return {
    take(prefix) {
      requirePrefix(prefix);
      const value = counters.get(prefix);
      counters.set(prefix, value + 1);
      return `${prefix}-${value}`;
    },
    restore(prefix, items) {
      requirePrefix(prefix);
      const pattern = new RegExp(`^${prefix}-(\\d+)$`);
      const highest = items.reduce((maximum, item) => Math.max(maximum, Number(String(item?.id || '').match(pattern)?.[1]) || 0), 0);
      counters.set(prefix, highest + 1);
    },
    reset() {
      for (const prefix of counters.keys()) counters.set(prefix, 1);
    },
  };
}

export function fileStem(value = 'molecule3d', fallback = 'molecule3d') {
  return String(value || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback;
}

export function downloadUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

export function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
