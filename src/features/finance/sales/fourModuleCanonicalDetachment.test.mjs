import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const files = [
  'src/features/accountant/services/accountant.service.js',
  'src/features/accountant/components/CashLocationSheet.jsx',
  'src/features/accountant/pages/AccountantHomePage.jsx',
  'src/features/moto-customer-care/services/motoCustomerCare.service.js',
  'src/features/receivables/api/receivables.api.js',
  'src/features/products/api/products.api.js',
  'src/features/finance/sales/financialSalesContext.service.js',
];
const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');

test('four detached modules contain no Legacy Showroom runtime dependency', () => {
  assert.doesNotMatch(source, /showroom_sales|showroom_sale_lines|features\/showroom|showroomService|ShowroomSaleViewSheet|showroom_sale:|settle_showroom_sale_|complete_showroom_sale|collect_showroom_sale_payment|\/app\/showroom_point/);
});

test('detached consumers use canonical Sales and Financial contracts', () => {
  assert.match(source, /get_financial_source_context/);
  assert.match(source, /get_sale_receipt_context/);
  assert.match(source, /from\('sales'\)/);
  assert.match(source, /'sale_lines'/);
  assert.match(source, /SettlementDialog/);
});
