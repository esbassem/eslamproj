export const storageKeys = {
  tenant: 'businesshub.tenant',
};

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function readStorage(key, fallback) {
  const storage = getStorage();

  if (!storage) {
    return fallback;
  }

  const value = storage.getItem(key);

  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  if (value === undefined || value === null) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, JSON.stringify(value));
}

export function clearStorage(key) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  storage.removeItem(key);
}

export function clearScopedStorage(keys) {
  keys.forEach((key) => clearStorage(key));
}

