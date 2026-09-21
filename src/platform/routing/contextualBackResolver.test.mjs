import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveContextualBack } from './contextualBackResolver.js';

test('returns the nearest linked parent for a detail route', () => {
  const back = resolveContextualBack({
    pathname: '/app/sales/42',
    breadcrumbs: [
      { label: 'الرئيسية', to: '/app' },
      { label: 'المبيعات', to: '/app/sales' },
      { label: 'تفاصيل البيع' },
    ],
  });
  assert.deepEqual(back, { label: 'العودة إلى المبيعات', to: '/app/sales' });
});

test('returns the application root for a secondary application page', () => {
  const back = resolveContextualBack({
    pathname: '/app/sales/new',
    breadcrumbs: [
      { label: 'الرئيسية', to: '/app' },
      { label: 'المبيعات', to: '/app/sales' },
      { label: 'بيع جديد' },
    ],
  });
  assert.deepEqual(back, { label: 'العودة إلى المبيعات', to: '/app/sales' });
});

test('hides back on application and platform landing routes', () => {
  assert.equal(resolveContextualBack({
    pathname: '/app/sales',
    breadcrumbs: [{ label: 'الرئيسية', to: '/app' }, { label: 'المبيعات', to: '/app/sales' }],
  }), null);
  assert.equal(resolveContextualBack({ pathname: '/app', breadcrumbs: [{ label: 'الرئيسية', to: '/app' }] }), null);
});
