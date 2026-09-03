import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./FinancialSetup.jsx', import.meta.url), 'utf8');

test('renders loading, ready, not-ready, retryable error, and access-denied states', () => {
  assert.match(source, /status: 'loading'/);
  assert.match(source, /النظام المالي جاهز للاستخدام/);
  assert.match(source, /الإعداد المالي يحتاج إلى استكمال/);
  assert.match(source, /إعادة المحاولة/);
  assert.match(source, /FINANCIAL_READINESS_ACCESS_DENIED/);
});

test('separates automatic foundation from user-configured money operation checks', () => {
  assert.match(source, /الأساس المالي/);
  assert.match(source, /ينشئه النظام عادةً تلقائيًا/);
  assert.match(source, /تشغيل الأموال/);
  assert.match(source, /أماكن الأموال/);
  assert.match(source, /طرق الدفع/);
});

test('future Money Destination and Payment Method actions are safe disabled placeholders', () => {
  assert.match(source, /navigate\(ROUTES\.settingsMoneyDestinations\)/);
  assert.match(source, /disabled title="سيتم إتاحته في مرحلة لاحقة"/);
  assert.match(source, /actionLabel/);
});

test('warnings are separate and clearing is not an unconditional setup card', () => {
  assert.match(source, /readiness\.warnings\.length/);
  assert.match(source, /تنبيهات/);
  assert.doesNotMatch(source, /\['clearing',/);
});
