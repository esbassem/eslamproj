import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./PaymentMethodsSettings.jsx', import.meta.url), 'utf8');

test('renders lightweight loading, access, error, empty, and list states', () => {
  for (const text of ['جاري تحميل طرق الدفع', 'لا يمكنك إدارة طرق الدفع', 'تعذر تحميل طرق الدفع', 'لا توجد طرق دفع', 'state.items.map']) assert.match(source, new RegExp(text));
  assert.doesNotMatch(source, /chart|recharts|dashboard/i);
});

test('create flow exposes only business name and supported types', () => {
  assert.match(source, /PAYMENT_METHOD_TYPES\.map/);
  assert.match(source, /<span>الاسم<\/span>/);
  assert.doesNotMatch(source, /cheque|other|clearing_account_id|clearing_journal_id|semantic_key/);
  assert.doesNotMatch(source, /اختر الخزنة|اختر البنك|اختر المحفظة/);
});

test('does not overwrite a manually edited name when type changes', () => {
  assert.match(source, /nameEdited\.current = true/);
  assert.match(source, /name: nameEdited\.current \? current\.name : defaultNames\[type\.code\]/);
});

test('loads clearing choices only after card selection and blocks incomplete cards', () => {
  assert.match(source, /values\.type === 'card' && optionsState\.status === 'idle'/);
  assert.match(source, /paymentMethodsSettingsService\.listClearingOptions/);
  assert.match(source, /items\.length === 1 \? items\[0\]\.key/);
  assert.match(source, /لا يوجد إعداد تسوية متاح للبطاقات/);
  assert.match(source, /cardReady/);
});

test('uses canonical create, rename, lifecycle, and readiness services', () => {
  assert.match(source, /paymentMethodsSettingsService\.create/);
  assert.match(source, /paymentMethodsSettingsService\.rename/);
  assert.match(source, /paymentMethodsSettingsService\.setActive/);
  assert.match(source, /financialReadinessService\.getReadiness\(tenantId\)/);
  assert.doesNotMatch(source, /\.from\(|\.insert\(|\.update\(|\.delete\(/);
});

test('offers no deletion or structural editing and links incomplete direct methods to destinations', () => {
  assert.doesNotMatch(source, /حذف|تعديل النوع|تعديل التسوية/);
  assert.match(source, /navigate\(ROUTES\.settingsMoneyDestinations\)/);
  assert.match(source, /تعديل الاسم/);
  assert.match(source, />تعطيل</);
  assert.match(source, /لن تكون طريقة الدفع متاحة للعمليات الجديدة/);
  assert.match(source, />تفعيل</);
});
