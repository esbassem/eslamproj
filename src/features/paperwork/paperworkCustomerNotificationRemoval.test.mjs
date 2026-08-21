import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const removedRuntimeTerms = /customer_notified|customer_notification|notify_paperwork_customer|client_notified|تسجيل إخطار العميل|إبلاغ العميل/i;

test('Paperwork frontend has no customer-notification runtime contract', () => {
  const sources = [
    read('./requests/RequestActions.jsx'),
    read('./services/internal/paperworkWorkflow.service.js'),
    read('./services/internal/paperworkDataCore.js'),
    read('./services/internal/paperworkRequestAdapters.js'),
    read('./services/internal/paperworkRequests.service.js'),
    read('./services/internal/paperworkReports.service.js'),
  ].join('\n');

  assert.doesNotMatch(sources, removedRuntimeTerms);
});

test('received paperwork is delivered directly with no intermediate action', () => {
  const viewModels = read('./adapters/paperworkViewModels.js');
  assert.match(viewModels, /received_from_processor:\s*\{\s*id:\s*'deliver',\s*label:\s*'تسليم للعميل'/);
  assert.doesNotMatch(read('./requests/RequestActions.jsx'), removedRuntimeTerms);
});

test('forward migration removes database runtime objects and preserves legacy event rows', () => {
  const migration = read('../../../supabase/migrations/20260821200000_remove_paperwork_customer_notification.sql');

  assert.match(migration, /drop function if exists public\.notify_paperwork_customer\(uuid, uuid, text, text\)/i);
  for (const column of ['customer_notified_at', 'customer_notified_by', 'customer_notification_channel', 'customer_notification_notes']) {
    assert.match(migration, new RegExp(`drop column if exists ${column}`, 'i'));
  }
  assert.match(migration, /drop index if exists public\.paperwork_requests_customer_notification_queue_idx/i);
  assert.match(migration, /add constraint paperwork_request_events_event_type_check[\s\S]*not valid/i);

  const activeAllowList = migration.match(/check \(event_type in \(([\s\S]*?)\)\) not valid/i)?.[1] || '';
  assert.doesNotMatch(activeAllowList, /customer_notified|client_notified/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.paperwork_request_events/i);
});
