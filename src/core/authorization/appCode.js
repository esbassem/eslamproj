const APP_CODE_ALIASES = Object.freeze({ accountant: 'accountant_app' });

export function normalizeAuthorizationAppCode(value) {
  const code = String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return APP_CODE_ALIASES[code] ?? code;
}
