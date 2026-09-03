import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptFinancialReadiness,
  financialReadinessService,
  presentFinancialRequirement,
  presentFinancialWarning,
} from './financialReadiness.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

function payload(overrides = {}) {
  return {
    tenant_id: tenantId,
    overall_ready: true,
    chart_ready: true,
    journals_ready: true,
    functional_accounts_ready: true,
    destinations_ready: true,
    payment_methods_ready: true,
    clearing_ready: true,
    missing_requirements: [],
    warnings: [],
    ...overrides,
  };
}

test('adapts the canonical READY response without recalculating readiness', () => {
  const readiness = adaptFinancialReadiness(payload(), tenantId);
  assert.equal(readiness.overallReady, true);
  assert.deepEqual(Object.values(readiness.checks), [true, true, true, true, true, true]);
});

test('keeps NOT READY, missing requirements, and warnings authoritative', () => {
  const readiness = adaptFinancialReadiness(payload({
    overall_ready: false,
    destinations_ready: false,
    clearing_ready: false,
    missing_requirements: [{ code: 'ACTIVE_MONEY_DESTINATION_REQUIRED', category: 'CONFIGURATION' }],
    warnings: [{ code: 'ENABLED_CLEARING_METHOD_NOT_READY', category: 'CONFIGURATION' }],
  }), tenantId);
  assert.equal(readiness.overallReady, false);
  assert.equal(readiness.missingRequirements[0].actionLabel, 'إضافة مكان أموال');
  assert.match(readiness.warnings[0].label, /المقاصة/);
});

test('maps all actual RPC requirement codes and preserves diagnostic codes', () => {
  const codes = [
    'CANONICAL_CHART_NOT_INSTALLED',
    'GENERAL_JOURNAL_NOT_CONFIGURED',
    'REQUIRED_FUNCTIONAL_ACCOUNTS_NOT_CONFIGURED',
    'ACTIVE_MONEY_DESTINATION_REQUIRED',
    'USABLE_PAYMENT_METHOD_REQUIRED',
  ];
  for (const code of codes) {
    const item = presentFinancialRequirement({ code });
    assert.equal(item.code, code);
    assert.doesNotMatch(item.label, new RegExp(code));
  }
});

test('unknown diagnostics use safe Arabic copy and retain the raw code', () => {
  const requirement = presentFinancialRequirement({ code: 'FUTURE_REQUIREMENT' });
  const warning = presentFinancialWarning({ code: 'FUTURE_WARNING' });
  assert.match(requirement.label, /مراجعة/);
  assert.match(requirement.detail, /FUTURE_REQUIREMENT/);
  assert.match(warning.detail, /FUTURE_WARNING/);
});

test('calls the readiness RPC once with the exact active tenant and no fallback', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: payload(), error: null }; } };
  const readiness = await financialReadinessService.getReadiness(tenantId, client);
  assert.equal(readiness.tenantId, tenantId);
  assert.deepEqual(calls, [['get_financial_readiness', { p_tenant_id: tenantId }]]);
});

test('rejects a missing tenant before making an RPC request', async () => {
  let called = false;
  const client = { rpc: async () => { called = true; } };
  await assert.rejects(() => financialReadinessService.getReadiness(null, client), { code: 'FINANCIAL_READINESS_TENANT_REQUIRED' });
  assert.equal(called, false);
});

test('rejects a cross-tenant response instead of accepting or falling back', async () => {
  const client = { rpc: async () => ({ data: payload({ tenant_id: '22222222-2222-4222-8222-222222222222' }), error: null }) };
  await assert.rejects(() => financialReadinessService.getReadiness(tenantId, client), { code: 'FINANCIAL_READINESS_TENANT_MISMATCH' });
});

test('classifies access denial separately from retryable RPC failures', async () => {
  const denied = { rpc: async () => ({ data: null, error: { code: '42501', message: 'FINANCIAL_READINESS_ACCESS_DENIED' } }) };
  const failed = { rpc: async () => ({ data: null, error: { code: '08006', message: 'connection failed' } }) };
  await assert.rejects(() => financialReadinessService.getReadiness(tenantId, denied), { code: 'FINANCIAL_READINESS_ACCESS_DENIED' });
  await assert.rejects(() => financialReadinessService.getReadiness(tenantId, failed), { code: 'FINANCIAL_READINESS_LOAD_FAILED' });
});
