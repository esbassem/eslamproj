export function createSingleEntryRequestCache() {
  let entry = null;

  return Object.freeze({
    load(key, loader, options = {}) {
      if (!options.force && entry?.key === key) {
        return entry.promise;
      }

      const promise = Promise.resolve().then(loader);
      entry = { key, promise };
      return promise;
    },
    clear() {
      entry = null;
    },
    getKey() {
      return entry?.key ?? null;
    },
  });
}
