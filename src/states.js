// The states a wholesaler can sell in. Phase 0 only needs the list; each state's rules setup (tax types, invoice
// fields, reports) is added in Phase 4 as a "structure" per state. StoreOwl never keeps tax rates: the wholesaler
// types in their own.

export const STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming']
];

const NAME = Object.fromEntries(STATES);

// States that touch each other, so "Do you also sell in other states?" can offer the neighbours first.
export const NEIGHBORS = {
  AL: 'FL GA MS TN', AK: '', AZ: 'CA CO NM NV UT', AR: 'LA MO MS OK TN TX', CA: 'AZ NV OR',
  CO: 'AZ KS NE NM OK UT WY', CT: 'MA NY RI', DE: 'MD NJ PA', DC: 'MD VA', FL: 'AL GA',
  GA: 'AL FL NC SC TN', HI: '', ID: 'MT NV OR UT WA WY', IL: 'IA IN KY MO WI', IN: 'IL KY MI OH',
  IA: 'IL MN MO NE SD WI', KS: 'CO MO NE OK', KY: 'IL IN MO OH TN VA WV', LA: 'AR MS TX', ME: 'NH',
  MD: 'DC DE PA VA WV', MA: 'CT NH NY RI VT', MI: 'IN OH WI', MN: 'IA ND SD WI', MS: 'AL AR LA TN',
  MO: 'AR IA IL KS KY NE OK TN', MT: 'ID ND SD WY', NE: 'CO IA KS MO SD WY', NV: 'AZ CA ID OR UT', NH: 'MA ME VT',
  NJ: 'DE NY PA', NM: 'AZ CO OK TX UT', NY: 'CT MA NJ PA VT', NC: 'GA SC TN VA', ND: 'MN MT SD',
  OH: 'IN KY MI PA WV', OK: 'AR CO KS MO NM TX', OR: 'CA ID NV WA', PA: 'DE MD NJ NY OH WV', RI: 'CT MA',
  SC: 'GA NC', SD: 'IA MN MT ND NE WY', TN: 'AL AR GA KY MO MS NC VA', TX: 'AR LA NM OK', UT: 'AZ CO ID NM NV WY',
  VT: 'MA NH NY', VA: 'DC KY MD NC TN WV', WA: 'ID OR', WV: 'KY MD OH PA VA', WI: 'IA IL MI MN',
  WY: 'CO ID MT NE SD UT'
};

export function stateName(code) { return NAME[String(code || '').toUpperCase()] || ''; }
export function isState(code) { return !!stateName(code); }
export function neighborsOf(code) { const s = NEIGHBORS[String(code || '').toUpperCase()]; return s ? s.split(' ') : []; }

// Cleans what the person picked: the home state first, other states sorted, no repeats, nothing unknown.
export function cleanStates(home, others) {
  const h = String(home || '').toUpperCase();
  if (!isState(h)) return null;
  const seen = new Set([h]);
  const rest = [];
  (others || []).forEach(function (c) {
    const k = String(c || '').toUpperCase();
    if (isState(k) && !seen.has(k)) { seen.add(k); rest.push(k); }
  });
  rest.sort();
  return { home: h, others: rest };
}

// One line for the screen: "Tennessee · also Kentucky and Virginia".
export function statesLine(home, others) {
  if (!home) return 'No state picked yet';
  const o = (others || []).map(stateName).filter(Boolean);
  if (!o.length) return stateName(home);
  const tail = o.length === 1 ? o[0] : o.slice(0, -1).join(', ') + ' and ' + o[o.length - 1];
  return stateName(home) + ' · also ' + tail;
}
