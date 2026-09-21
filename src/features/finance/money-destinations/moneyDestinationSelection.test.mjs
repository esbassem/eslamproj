import assert from 'node:assert/strict';
import {
  NO_ALLOWED_DESTINATION_MESSAGE,
  normalizeMoneyDestinationSelection,
} from './moneyDestinationSelection.js';

const none = normalizeMoneyDestinationSelection({ destinations: [] });
assert.equal(none.selectionState, 'none');
assert.equal(none.autoSelectedDestinationId, null);
assert.equal(none.message, NO_ALLOWED_DESTINATION_MESSAGE);

const single = normalizeMoneyDestinationSelection({
  destinations: [{ destination_id: 'custody-1', destination_name: 'عهدتي' }],
});
assert.equal(single.selectionState, 'single');
assert.equal(single.autoSelectedDestinationId, 'custody-1');

const multiple = normalizeMoneyDestinationSelection({
  destinations: [{ destination_id: 'cashbox-1' }, { destination_id: 'bank-1' }],
});
assert.equal(multiple.selectionState, 'multiple');
assert.equal(multiple.autoSelectedDestinationId, null);
