export const NAVIGATION_MODES = Object.freeze(['none', 'sidebar']);
export const CONTENT_WIDTHS = Object.freeze(['compact', 'standard', 'wide', 'fullBleed']);
export const SHELL_VARIANTS = Object.freeze(['standard', 'wide', 'fullBleed']);

const DEFAULT_NAVIGATION = Object.freeze({ mode: 'none', items: Object.freeze([]) });
const DEFAULT_SHELL = Object.freeze({
  contentWidth: 'standard',
  variant: 'standard',
  topBar: true,
  topBarDivider: true,
  appIdentity: true,
  breadcrumbs: true,
});

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function validateNavigationDefinition(navigation = DEFAULT_NAVIGATION) {
  invariant(navigation && typeof navigation === 'object', 'App navigation must be an object.');
  invariant(NAVIGATION_MODES.includes(navigation.mode), `Unsupported navigation mode: ${navigation.mode}`);
  if (navigation.items !== undefined) {
    invariant(Array.isArray(navigation.items), 'App navigation items must be an array.');
  }
  return true;
}

export function validateAppRegistration(registration) {
  invariant(registration && typeof registration === 'object', 'App registration must be an object.');
  invariant(typeof registration.code === 'string' && registration.code.trim(), 'App registration requires a code.');
  invariant(typeof registration.name === 'string' && registration.name.trim(), 'App registration requires a name.');
  validateNavigationDefinition(registration.navigation ?? DEFAULT_NAVIGATION);
  const shell = registration.shell ?? DEFAULT_SHELL;
  invariant(CONTENT_WIDTHS.includes(shell.contentWidth ?? DEFAULT_SHELL.contentWidth), `Unsupported content width: ${shell.contentWidth}`);
  invariant(SHELL_VARIANTS.includes(shell.variant ?? DEFAULT_SHELL.variant), `Unsupported shell variant: ${shell.variant}`);
  invariant(shell.topBar === undefined || typeof shell.topBar === 'boolean', 'Shell topBar policy must be boolean.');
  invariant(shell.topBarDivider === undefined || typeof shell.topBarDivider === 'boolean', 'Shell topBar divider policy must be boolean.');
  invariant(shell.appIdentity === undefined || typeof shell.appIdentity === 'boolean', 'Shell app identity policy must be boolean.');
  invariant(shell.breadcrumbs === undefined || typeof shell.breadcrumbs === 'boolean', 'Shell breadcrumbs policy must be boolean.');
  return true;
}

export function normalizeAppRegistration(registration) {
  validateAppRegistration(registration);
  return Object.freeze({
    ...registration,
    code: registration.code.trim(),
    name: registration.name.trim(),
    navigation: Object.freeze({
      ...DEFAULT_NAVIGATION,
      ...registration.navigation,
      items: Object.freeze([...(registration.navigation?.items ?? [])]),
    }),
    shell: Object.freeze({ ...DEFAULT_SHELL, ...registration.shell }),
  });
}

export function createNavigationRegistry(registrations = []) {
  const entries = new Map();
  registrations.forEach((registration) => {
    const normalized = normalizeAppRegistration(registration);
    invariant(!entries.has(normalized.code), `Duplicate app registration: ${normalized.code}`);
    entries.set(normalized.code, normalized);
  });
  return Object.freeze({
    get: (appCode) => entries.get(String(appCode ?? '').trim()) ?? null,
    has: (appCode) => entries.has(String(appCode ?? '').trim()),
    list: () => [...entries.values()],
  });
}

export const EMPTY_APP_REGISTRY = createNavigationRegistry();
