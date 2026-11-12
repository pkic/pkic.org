/**
 * The screen page's storage: this browser's local storage, or, where the
 * browser refuses it (a blocked site, a strict private window), storage that
 * lasts this visit only. Reaching `localStorage` itself can throw, so the
 * check is guarded too.
 */
export function screenStorage(win: Pick<Window, "localStorage"> = window): Storage {
  try {
    const storage = win.localStorage;
    const probe = "pkic.screen.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
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
