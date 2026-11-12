/**
 * The screen page's storage: this browser's local storage, or, where the
 * browser refuses it (a blocked site, a strict private window), storage that
 * lasts this visit only. Reaching `localStorage` itself can throw, so the
 * check is guarded too. Storage that can be read but not written (a full
 * quota) keeps what it holds, with this visit's writes on top.
 */
export function screenStorage(win: Pick<Window, "localStorage"> = window): Storage {
  let storage: Storage;
  try {
    storage = win.localStorage;
    storage.getItem("pkic.screen.probe");
  } catch {
    return memoryStorage();
  }
  try {
    const probe = "pkic.screen.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return overlaidStorage(storage);
  }
}

/** Reads from `persisted` until this visit writes or removes a key; a write it refuses stays in memory. */
function overlaidStorage(persisted: Storage): Storage {
  const written = memoryStorage();
  const removed = new Set<string>();
  const read = (key: string) => {
    try {
      return persisted.getItem(key);
    } catch {
      return null;
    }
  };
  const keys = () => {
    const all = new Set<string>();
    try {
      for (let index = 0; index < persisted.length; index += 1) {
        const key = persisted.key(index);
        if (key !== null && !removed.has(key)) all.add(key);
      }
    } catch {
      /* Only this visit's keys. */
    }
    for (let index = 0; index < written.length; index += 1) all.add(written.key(index)!);
    return [...all];
  };
  return {
    get length() {
      return keys().length;
    },
    clear: () => {
      for (const key of keys()) removed.add(key);
      written.clear();
    },
    getItem: (key) => written.getItem(key) ?? (removed.has(key) ? null : read(key)),
    key: (index) => keys()[index] ?? null,
    removeItem: (key) => {
      written.removeItem(key);
      removed.add(key);
    },
    setItem: (key, value) => {
      removed.delete(key);
      try {
        persisted.setItem(key, value);
        written.removeItem(key);
      } catch {
        written.setItem(key, value);
      }
    },
  };
}

export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}
