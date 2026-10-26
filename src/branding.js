// Copy only the application's known preference keys; never overwrite new values.
(() => {
  const previousPrefix = ['better', 'box'].join('');
  for (const suffix of ['preferences', 'imageTypes', 'manualCoverModes', 'manualReadingModes']) {
    try {
      const storage = globalThis.localStorage;
      const key = `opencabinet.${suffix}`;
      if (storage?.getItem(key) == null) {
        const previous = storage?.getItem(`${previousPrefix}.${suffix}`);
        if (previous != null) storage.setItem(key, previous);
      }
    } catch { /* Preferences remain optional if browser storage is unavailable. */ }
  }
})();
