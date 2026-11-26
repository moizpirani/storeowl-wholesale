// The import reader on its own: CSV, column guessing, values, problems in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, guessKind, guessMap, buildItems, buildCustomers, upcFrom, dateFrom, termsFrom, levelFrom, categoryFrom, money } from '../src/importer.js';

const L = [{ n: 1, name: 'L1' }, { n: 2, name: 'L2' }, { n: 3, name: 'L3' }];

test('reads CSV with quotes, a title row and blank lines', () => {
  const t = parseCsv('Knox Wholesale item list\n\nDESCRIPTION,UPC,"PRICE, A"\n"SENECA ""FF"" BOX",14700319017,34.20\r\n,,\n');
  assert.deepEqual(t.head, ['DESCRIPTION', 'UPC', 'PRICE, A']);
  assert.deepEqual(t.rows, [['SENECA "FF" BOX', '14700319017', '34.20']]);
  assert.equal(parseCsv('a;b\n1;2').head[1], 'b');
});

test('guesses the kind of list and the columns', () => {
  assert.equal(guessKind(['Description', 'UPC', 'Cost', 'Price1']), 'items');
  assert.equal(guessKind(['Customer Name', 'Account #', 'Balance', 'Terms', 'City']), 'customers');
  assert.deepEqual(guessMap('items', ['DESCRIPTION', 'UPC', 'ITEM#', 'DEPT', 'UNIT', 'COST', 'PRICE1', 'PRICE2', 'PRICE3', 'NOTES'], L),
    ['name', 'upc', 'item_no', 'category', 'size', 'cost', 'p1', 'p2', 'p3', '']);
  assert.deepEqual(guessMap('items', ['Name', 'L2', 'L1'], L), ['name', 'p2', 'p1']);
  assert.deepEqual(guessMap('customers', ['Customer', 'Store #', 'Balance', 'Tobacco License', 'Tobacco Exp'], L),
    ['name', 'store_no', 'balance', 'tobacco_no', 'tobacco_exp']);
});

test('values: UPCs, dates, terms, levels, categories, money', () => {
  assert.deepEqual(upcFrom('28200003843'), { upc: '028200003843', fixed: true });
  assert.deepEqual(upcFrom('14700319017'), { upc: '14700319017' }, 'no 0 added when the check digit says no');
  assert.match(upcFrom('1.47003E+11').bad, /cut short by Excel/);
  assert.deepEqual(upcFrom('0 14700 31901 7'), { upc: '014700319017' });
  assert.equal(dateFrom('12/8/26').d, '2026-12-08'); assert.equal(dateFrom('2027-01-31').d, '2027-01-31');
  assert.equal(dateFrom('46365').d, '2026-12-09'); assert.match(dateFrom('13/45/2026').bad, /doesn’t look right/);
  assert.equal(termsFrom('NET 14'), 'net14'); assert.equal(termsFrom('C.O.D.'), 'cod'); assert.equal(termsFrom('Prepaid'), 'advance'); assert.equal(termsFrom('whenever'), undefined);
  assert.equal(levelFrom('B', L), 2); assert.equal(levelFrom('L3', L), 3); assert.equal(levelFrom('price 1', L), 1); assert.equal(levelFrom('Gold', L), undefined);
  assert.equal(categoryFrom('CIGS'), 'cigarettes'); assert.equal(categoryFrom('Cigarillos'), 'cigars'); assert.equal(categoryFrom('Disposable vapes'), 'vapor'); assert.equal(categoryFrom('Candy'), 'other');
  assert.equal(money('$1,284.40'), 1284.4); assert.equal(money('(12.00)'), -12); assert.ok(isNaN(money('abc')));
});

test('items: good rows, problems, already-here rows', () => {
  const t = parseCsv('Description,UPC,Unit,Cost,Price1\nMARLBORO RED BOX CTN,28200003843,CTN,71.10,79.90\nNO UPC ITEM,,EA,1.00,2.00\nDUP,028200003843,CTN,1,2\n,,,,\nBAD COST,123456,EA,abc,2\nOLD ONE,014700319017,CTN,28,34');
  const b = buildItems(t, guessMap('items', t.head, L), L, [{ sizes: [{ upc: '014700319017' }] }]);
  assert.equal(b.good.length, 2); assert.equal(b.fixed, 1);
  assert.deepEqual(b.good[0].sizes[0], { name: 'Carton', n: 10, upc: '028200003843', cost: 71.1, prices: { 1: 79.9 } });
  assert.equal(b.good[0].category, 'other', 'no category column and no category word in the name');
  assert.deepEqual(b.bad.map((x) => x.why), ['Same UPC as row 2.', 'The cost abc isn’t a number.']);
  assert.equal(b.skip[0].name, 'OLD ONE');
});

test('customers: balances add up, licenses come along, problems in plain words', () => {
  const t = parseCsv('Customer,Store #,Terms,Level,Balance,Resale #,Tobacco License,Tobacco Exp,Email\n' +
    'Clinton Hwy Market,104,Net 7,A,"$1,284.40",0106376987,46-2218840,9/30/2027,\nPowell Quick Stop,307,net 7,C,(10.00),,,,\n' +
    'Bad Terms,1,whenever,,0,,,,\nBad Level,2,,Gold,0,,,,\nClinton Hwy Market,104,,,,,,,\nBad Mail,3,,,,,,,nope');
  const b = buildCustomers(t, guessMap('customers', t.head, L), L, [], 1);
  assert.equal(b.good.length, 2); assert.equal(b.balance, 1274.4);
  assert.deepEqual(b.good[0].licenses, [{ kind: 'resale', number: '0106376987' }, { kind: 'tobacco', number: '46-2218840', expires: '2027-09-30' }]);
  assert.equal(b.good[0].level, 1); assert.equal(b.good[1].level, 3); assert.equal(b.good[0].terms, 'net7');
  assert.deepEqual(b.bad.map((x) => x.why), ['StoreOwl doesn’t know the terms “whenever”.', 'No price level called “Gold”.', 'Same customer as row 2.', 'The email nope doesn’t look right.']);
});

test('balances on rows left out are counted, so the check can say where a gap is', () => {
  const t = parseCsv('Name,Balance,Level\nA,10,A\n,5,A\nB,7,Z\n');
  const lv = [{ n: 1, name: 'A' }];
  const b = buildCustomers(t, guessMap('customers', t.head, lv), lv, [], 1);
  assert.equal(b.balance, 10);
  assert.equal(b.outBal, 12);
});
