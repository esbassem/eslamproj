export function createLegacyRedirectAdapter(entries = []) {
  const redirects = new Map(entries.map(({ from, to }) => [from, to]));
  return Object.freeze({
    resolve(pathname, search = '') {
      const target = redirects.get(pathname);
      if (!target) return null;
      return typeof target === 'function' ? target({ pathname, search }) : `${target}${search}`;
    },
    entries: () => entries.map((entry) => ({ ...entry })),
  });
}
