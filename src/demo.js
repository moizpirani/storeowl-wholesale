// Made-up data for pictures on this computer only (VITE_FAKE=1 VITE_FAKE_DEMO=1). Never used with a real database.
export async function seedDemo(db) {
  const c = await db.createCompany({ name: 'Knox Test Wholesale', home: 'TN', others: ['KY', 'VA'], your_name: 'Moiz' });
  await db.levelsSet(c.id, [{ n: 1, name: 'L1' }, { n: 2, name: 'L2' }, { n: 3, name: 'L3' }]);
  const it = (name, category, unit, sizes, extra) => db.itemPut(c.id, Object.assign({ name, category, unit, age: category === 'other' ? 0 : 21, sizes }, extra || {}));
  const z = (name, n, upc, cost, a, b, cc) => ({ name, n, upc, cost, prices: { 1: a, 2: b, 3: cc } });
  await it('Seneca Full Flavor Box', 'cigarettes', 'pack', [z('Carton', 10, '014700319017', 28.9, 34.2, 33.9, 33.6), z('Case', 500, '10014700319014', 1445, 1701, 1686, 1671), z('Pack', 1, '01470031900', 2.89, 3.6, 3.55, 3.5)], { item_no: '4471', vendor: 'ITG Brands', nacs: '02' });
  await it('Seneca Menthol Box', 'cigarettes', 'pack', [z('Carton', 10, '014700319024', 28.9, 34.2, 33.9, 33.6)], { vendor: 'ITG Brands' });
  await it('Teton Red 100 Box', 'cigarettes', 'pack', [z('Carton', 10, '057125001102', 27.4, 32.7, 32.4, 32.1)]);
  await it('Marlboro Red Box', 'cigarettes', 'pack', [z('Carton', 10, '028200003843', 71.1, 79.9, 79.4, 78.9), z('Pack', 1, '02820000384', 7.11, 8.3, 8.25, 8.2)], { vendor: 'Altria', item_no: '2201' });
  await it('Swisher Sweets Grape 2/$1.29', 'cigars', 'cigarillo', [z('Box', 60, '025900412623', 24.1, 29.99, 29.49, 28.99)]);
  await it('Juicy Swisher Cigarillos 2/99¢', 'cigars', 'cigarillo', [z('Box', 60, '025900413125', 22.4, 27.99, 27.49, 26.99)]);
  await it('Grabba Leaf Small', 'cigars', 'leaf', [z('Box', 25, '850003190226', 31.25, 39.99, 38.99, 37.99)]);
  await it('Geek Bar Pulse X Blue Razz', 'vapor', 'device', [z('Box', 5, '', 38.5, 49.88, 48.5, 47)], { ml: 18 });
  await it('ZYN Cool Mint 6 mg', 'pouches', 'can', [z('Roll', 5, '897190000641', 21.8, 26.5, 26.25, 25.9), z('Can', 1, '89719000064', 4.36, 5.4, 5.35, 5.3)]);
  await it('KLAZ Tabs Mango', 'hemp', 'pack', [z('Box', 25, '860009773128', null, 45, 44, 43)]);
  await db.companyPut(c.id, { phone: '(865) 555-0100', email: 'office@knoxtestwholesale.com', addr: '2300 N Broadway', city: 'Knoxville', state: 'TN', zip: '37917' });
  await db.settingsSet(c.id, { inv: { lic: 'TN Tobacco Distributor #TD-12345\nTN Sales Tax #1000223344', msa: '0457' } });
  const cu = async (p, lic) => { const x = await db.customerPut(c.id, p); for (const l of lic || []) await db.licensePut(c.id, x.id, l); return x; };
  const may = await cu({ name: 'Maynardville Fuel Stop', store_no: '211', addr: '4721 Maynardville Hwy', city: 'Maynardville', state: 'TN', zip: '37807', phone: '(865) 992-4410',
    email: 'raj@mfstop.com', edi_email: 'invoices@mfstop-backoffice.com', acct_no: '211', gets: { print: true, edi: true }, level: 2, terms: 'net14', credit_limit: 5000, delivery: 'Monday', route: '3', rep: 'Ali K.', since: '2021-03-01',
    contacts: [{ name: 'Raj Patel', role: 'Owner', phone: '(865) 992-4410' }, { name: 'Priya Patel', role: 'Orders', phone: '(865) 992-4411' }] },
  [{ kind: 'resale', number: '0108841203', copy: true }, { kind: 'location', number: '0108841203-001', copy: true }, { kind: 'tobacco', number: '46-3310389', expires: '2026-12-08', copy: true }, { kind: 'hemp', number: 'HDC-22918', expires: '2027-06-30' }]);
  await db.noteAdd(c.id, may.id, 'Pays by check on Fridays. Call Priya for orders.');
  await cu({ name: 'Clinton Hwy Market', store_no: '104', city: 'Knoxville', level: 1, terms: 'net7', credit_limit: 5000 }, [{ kind: 'resale', number: '0106376987' }, { kind: 'tobacco', number: '46-2218840', expires: '2027-09-30' }]);
  await cu({ name: 'Rutledge Pike Food Mart', store_no: '118', city: 'Knoxville', level: 1, terms: 'net14', credit_limit: 5000 }, [{ kind: 'resale', number: '0107712455' }, { kind: 'tobacco', number: '46-1190032', expires: '2027-03-31' }]);
  await cu({ name: 'Powell Quick Stop', store_no: '307', city: 'Powell', level: 3, terms: 'net7', credit_limit: 6000 }, [{ kind: 'resale', number: '0109023318' }, { kind: 'tobacco', number: '46-9001283', expires: '2026-11-15' }]);
  await cu({ name: 'Corryton Country Store', store_no: '095', city: 'Corryton', level: 2, terms: 'advance', tobacco: false }, []);
  await cu({ name: 'Halls Crossroads Exxon', store_no: '143', city: 'Knoxville', level: 1, terms: 'net7', credit_limit: 4000 }, [{ kind: 'resale', number: '0106620981' }, { kind: 'tobacco', number: '46-4410077', expires: '2027-12-31' }]);
  await cu({ name: 'Norris Freeway Shell', store_no: '162', city: 'Norris', level: 1, terms: 'net7', credit_limit: 5000 }, [{ kind: 'resale', number: '0109934410' }, { kind: 'tobacco', number: '46-5528810', expires: '2027-05-31' }]);
  await cu({ name: 'Emory Road Market', store_no: '077', city: 'Powell', level: 2, terms: 'net14', credit_limit: 3000 }, [{ kind: 'resale', number: '0105529007' }, { kind: 'tobacco', number: '46-7702214', expires: '2027-08-31' }]);
}
