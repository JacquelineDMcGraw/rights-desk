import assert from 'node:assert/strict';
import { createLegalHelpLookup } from '../lib/legal-help.mjs';

const locations = {
  'us/02139': ['Cambridge', 'Massachusetts', 42.3646, -71.1042],
  'pr/00901': ['San Juan', 'San Juan', 18.4663, -66.1057],
  'vi/00801': ['Saint Thomas', '', 18.34, -64.93],
  'gu/96910': ['Hagåtña', '', 13.4757, 144.7489],
  'as/96799': ['Pago Pago', '', -14.2781, -170.7025],
  'mp/96950': ['Saipan', '', 15.2, 145.75],
};
const calls = [];
const sampleOffice = (id, name, lat, tags = {}) => ({
  id, type: 'node', lat, lon: -71.1042, tags: { office: 'lawyer', name, ...tags },
});
const offices = [
  sampleOffice(2, 'Example IP Office', 42.39, {
    'addr:housenumber': '42', 'addr:street': 'Sample Avenue', 'addr:city': 'Cambridge',
    'addr:state': 'MA', 'addr:postcode': '02139', website: 'https://example.org/',
    'lawyer:speciality': 'intellectual_property;family law',
  }),
  sampleOffice(1, 'Example Local Office', 42.37, { website: 'http://example.net/' }),
  sampleOffice(3, 'Example Local Office', 42.37),
  sampleOffice(4, 'Out of Range', 48),
  sampleOffice(5, 'Example Foreign Office', 42.37, { 'addr:country': 'CA' }),
  sampleOffice(6, 'Different Office Type', 42.37, { office: 'accountant' }),
];
let offline = false;
const fetchImpl = async (raw, options) => {
  const url = new URL(raw);
  calls.push({ url, options });
  assert.match(options.headers['user-agent'], /RightsDesk/);
  assert.equal(options.redirect, 'error');
  if (url.hostname === 'api.zippopotam.us') {
    const key = url.pathname.slice(1);
    const location = locations[key];
    if (!location) return new Response('{}', { status: 404 });
    const [place, state, latitude, longitude] = location;
    const [area, zip] = key.split('/');
    return Response.json({
      'post code': zip, 'country abbreviation': area.toUpperCase(),
      places: [{ 'place name': place, state, latitude, longitude }],
    });
  }
  assert.ok(['ovp.dresel.systems', 'overpass.private.coffee'].includes(url.hostname));
  assert.equal(options.method, 'POST');
  const query = options.body.get('data');
  assert.match(query, /nwr\((?:[-\d.]+,){3}[-\d.]+\)/);
  assert.match(query, /\["office"="lawyer"\]\["name"\];out center 100;/);
  assert.doesNotMatch(query, /02139|Cambridge|Massachusetts/);
  if (offline) return new Response('{}', { status: 429 });
  return Response.json({ elements: offices });
};
const find = createLegalHelpLookup({ fetchImpl, intervalMs: 0 });
await assert.rejects(find('bad'), { status: 400, code: 'INVALID_ZIP' });
assert.equal(calls.length, 0);
const [one, two] = await Promise.all([find('02139'), find('02139')]);
assert.deepEqual(one, two);
assert.equal(calls.length, 2);
assert.equal(one.place, 'Cambridge');
assert.equal(one.region, 'Massachusetts');
assert.equal(one.source, 'OpenStreetMap');
assert.deepEqual(one.offices.map(office => office.name), ['Example Local Office', 'Example IP Office']);
assert.equal(one.offices[0].website, '');
assert.equal(one.offices[0].specialty, '');
assert.equal(one.offices[1].specialty, 'intellectual property');
assert.equal(one.offices[1].address, '42 Sample Avenue, Cambridge, MA 02139');
assert.equal(one.offices[1].mapUrl, 'https://www.openstreetmap.org/node/2');
await find('02139');
assert.equal(calls.length, 2);

for (const [zip, region] of [
  ['00901', 'Puerto Rico'], ['00801', 'U.S. Virgin Islands'], ['96910', 'Guam'],
  ['96799', 'American Samoa'], ['96950', 'Northern Mariana Islands'],
]) {
  assert.equal((await find(zip)).region, region);
}
assert.equal((await find('96950')).offices.length, 0);
await assert.rejects(find('00000'), { status: 404, code: 'ZIP_NOT_FOUND' });
offline = true;
const partial = createLegalHelpLookup({ fetchImpl, intervalMs: 0 });
assert.equal((await partial('02139')).lookupIncomplete, true);
offline = false;
assert.equal((await partial('02139')).offices.length, 2);
console.log('Legal help lookup passed ZIP, territory, sorting, safe links, attribution, caching, and degraded-provider checks.');
