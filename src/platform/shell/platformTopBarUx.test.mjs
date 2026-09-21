import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const topBar = read('./PlatformTopBar.jsx');
const shell = read('./PlatformShell.jsx');
const utilities = read('../../app/layouts/LegacyPlatformAccountArea.jsx');
const contextualBack = read('../routing/contextualBackResolver.js');

test('top bar separates navigation context from user utilities', () => {
  assert.match(topBar, /data-topbar-region="context"/);
  assert.match(topBar, /data-topbar-region="utilities"/);
  assert.match(topBar, /className="flex min-w-0 flex-1/);
  assert.match(topBar, /className="flex shrink-0 items-center/);
});

test('platform entry uses a quiet application launcher instead of a prominent home label', () => {
  assert.match(topBar, /home = \{ label: 'مركز التطبيقات', to: '\/app' \}/);
  assert.match(topBar, /<LayoutGrid/);
  assert.match(topBar, /aria-label=\{home\.label\}/);
  assert.match(topBar, /text-slate-400/);
  assert.doesNotMatch(topBar, />\s*\{home\.label\}\s*</);
});

test('contextual back precedes the launcher and uses a deterministic parent route', () => {
  assert.match(topBar, /contextualBack[\s\S]*to=\{contextualBack\.to\}[\s\S]*<ArrowLeft[\s\S]*to=\{home\.to\}/);
  assert.match(topBar, /aria-label=\{contextualBack\.label\}/);
  assert.match(topBar, /rtl:rotate-180/);
  assert.match(contextualBack, /breadcrumbs\.findLast/);
  assert.doesNotMatch(`${topBar}\n${contextualBack}`, /navigate\(-1\)|history\.back/);
});

test('top bar fills shell chrome and is independent from page max width', () => {
  assert.match(topBar, /<header className=\{`[^`]*w-full/);
  assert.match(topBar, /<div className="[^"]*w-full/);
  assert.doesNotMatch(topBar, /<header className="[^"]*max-w-|<div className="[^"]*max-w-[^"]*w-full/);
});

test('top bar divider is controlled by shell policy instead of route-specific markup', () => {
  assert.match(topBar, /showDivider = true/);
  assert.match(topBar, /showDivider \? 'border-b border-slate-200' : ''/);
  assert.match(shell, /showDivider=\{policy\.topBarDivider\}/);
});

test('application identity visibility is controlled by shell policy', () => {
  assert.match(topBar, /showAppIdentity = true/);
  assert.match(topBar, /app && showAppIdentity/);
  assert.match(shell, /showAppIdentity=\{policy\.appIdentity\}/);
});

test('top bar visually connects application identity to the active route', () => {
  assert.match(topBar, /showAppIdentity && visibleBreadcrumbs\.length/);
  assert.match(topBar, /<ChevronLeft[^>]*strokeWidth=\{1\.5\}/);
});

test('direction is inherited and layout uses logical direction-aware utilities', () => {
  assert.doesNotMatch(topBar, /dir="(?:rtl|ltr)"|\b(?:ml|mr|pl|pr|left|right)-/);
  assert.doesNotMatch(shell, /dir="rtl"/);
  assert.match(topBar, /border-s|ps-/);
});

test('mobile keeps compact utilities and truncates route context without overflow', () => {
  assert.match(topBar, /overflow-hidden/);
  assert.match(topBar, /current \? 'flex' : 'hidden sm:flex'/);
  assert.match(topBar, /max-w-32 truncate/);
  assert.match(utilities, /h-9 w-9/);
});

test('language and account are semantic utility controls with accessible focus and menu state', () => {
  assert.match(utilities, /<Languages/);
  assert.match(utilities, /type="button"[\s\S]*aria-label=\{`تغيير اللغة/);
  assert.match(utilities, /<DropdownMenuTrigger asChild>/);
  assert.match(utilities, /aria-label=\{`قائمة الحساب/);
  assert.match(utilities, /focus-visible:ring-2/);
  assert.match(utilities, /<UserRound/);
  assert.doesNotMatch(utilities, /<Avatar|<ChevronDown|<CircleUserRound|<Globe2/);
});

test('existing language, settings, notification and sign-out behavior remains connected', () => {
  assert.match(utilities, /onClick=\{toggleLocale\}/);
  assert.match(utilities, /to=\{ROUTES\.settings\}/);
  assert.match(utilities, /requestAndSaveOneSignalSubscription/);
  assert.match(utilities, /await signOut\(\)/);
  assert.match(utilities, /navigate\(ROUTES\.landing\)/);
});

test('platform top bar remains feature-agnostic', () => {
  assert.doesNotMatch(topBar, /@\/features|sales|inventory|paperwork|appCode\s*===/i);
});
