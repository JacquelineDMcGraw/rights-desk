const ZIP_LOOKUP_URL = 'https://api.zippopotam.us/';
const NORTH_AMERICA_OVERPASS_URL = 'https://ovp.dresel.systems/api-na/interpreter';
const GLOBAL_OVERPASS_URL = 'https://overpass.private.coffee/api/interpreter';
const USER_AGENT = 'RightsDesk/0.1 (local creator legal-help directory; https://github.com/JacquelineDMcGraw/rights-desk)';
const SEARCH_RADIUS_METERS = 40_234;
const US_AREAS = new Map([
  ['us', 'United States'], ['pr', 'Puerto Rico'], ['vi', 'U.S. Virgin Islands'],
  ['gu', 'Guam'], ['as', 'American Samoa'], ['mp', 'Northern Mariana Islands'],
]);

function lookupError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function unavailable() {
  return lookupError(503, 'LEGAL_LOOKUP_UNAVAILABLE', 'The ZIP lookup is temporarily unavailable. Try again or use a lawyer referral directory below.');
}

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function plain(value, limit = 150) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function coordinates(value) {
  if (value?.lat == null || value?.lon == null || value.lat === '' || value.lon === '') return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function createThrottle(intervalMs) {
  let queue = Promise.resolve();
  let nextStart = 0;
  let pending = 0;
  return (operation) => {
    if (pending >= 4) return Promise.reject(unavailable());
    pending++;
    const job = queue.then(async () => {
      const remaining = nextStart - performance.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      nextStart = performance.now() + intervalMs;
      return operation();
    }).finally(() => { pending--; });
    queue = job.catch(() => {});
    return job;
  };
}

function createCache() {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry?.until > Date.now()) return entry.value;
      entries.delete(key);
      return undefined;
    },
    set(key, value, ttlMs) {
      entries.set(key, { value, until: Date.now() + ttlMs });
      if (entries.size > 128) entries.delete(entries.keys().next().value);
    },
  };
}

async function fetchJson(fetchImpl, url, timeoutMs, { allowMissing = false, ...options } = {}) {
  const response = await fetchImpl(url.href, {
    ...options,
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...options.headers },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok || !response.body) throw unavailable();
  const maxBytes = 384_000;
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw unavailable();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw unavailable();
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
}

function postalRegions(zip) {
  if (zip.startsWith('008')) return ['vi', 'us'];
  if (/^00[679]/.test(zip)) return ['pr', 'us'];
  if (zip === '96799') return ['as', 'us'];
  if (/^969[123]/.test(zip)) return ['gu', 'us'];
  if (/^9695[0-2]$/.test(zip)) return ['mp', 'us'];
  return ['us'];
}

function zipLocation(data, zip, area) {
  if (data === null) return null;
  if (data?.['post code'] !== zip || !Array.isArray(data?.places) || data['country abbreviation']?.toLowerCase() !== area) throw unavailable();
  for (const item of data.places) {
    const point = coordinates({ lat: item?.latitude, lon: item?.longitude });
    if (!point) continue;
    const place = plain(item['place name']) || `ZIP ${zip}`;
    const region = area === 'us' ? plain(item.state) || US_AREAS.get(area) : US_AREAS.get(area);
    return { ...point, place, region };
  }
  return null;
}

function milesBetween(origin, destination) {
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLat = radians(destination.lat - origin.lat);
  const deltaLon = radians(destination.lon - origin.lon);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(deltaLon / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}

function officeSearchArea({ lat, lon }) {
  const latitudeMargin = SEARCH_RADIUS_METERS / 110_000;
  const longitudeMargin = latitudeMargin / Math.cos(lat * Math.PI / 180);
  const bounds = [lat - latitudeMargin, lon - longitudeMargin, lat + latitudeMargin, lon + longitudeMargin];
  if (bounds.some((value, index) => Math.abs(value) > (index % 2 ? 180 : 90))) {
    return `around:${SEARCH_RADIUS_METERS},${lat.toFixed(5)},${lon.toFixed(5)}`;
  }
  return bounds.map(value => value.toFixed(5)).join(',');
}

function officeAddress(tags) {
  const street = [tags['addr:housenumber'], tags['addr:street']].map(value => plain(value)).filter(Boolean).join(' ');
  const region = [tags['addr:state'], tags['addr:postcode']].map(value => plain(value)).filter(Boolean).join(' ');
  return [street, plain(tags['addr:city']), region].filter(Boolean).join(', ');
}

function officeSpecialty(tags) {
  const declared = plain(tags['lawyer:speciality'] || tags['lawyer:specialty'] || tags['lawyer:practice_area'] || tags.speciality || tags.specialty);
  return declared.replaceAll('_', ' ').split(/[,;]/).map(value => value.trim()).filter(value =>
    /^(?:copyright(?: law)?|intellectual property(?: law)?|ip law|entertainment law|licensing)$/i.test(value)
  ).join(', ');
}

function legalOffices(data, location) {
  if (!Array.isArray(data?.elements) || data.remark) throw unavailable();
  const seen = new Set();
  return data.elements.flatMap(item => {
    const tags = item?.tags;
    const point = coordinates(item?.center || item);
    const name = plain(tags?.name);
    if (!name || !point || tags.office !== 'lawyer') return [];
    const country = plain(tags['addr:country']).toLowerCase();
    if (country && !US_AREAS.has(country) && ![...US_AREAS.values()].some(area => area.toLowerCase() === country)) return [];
    if (!['node', 'way', 'relation'].includes(item.type) || !Number.isSafeInteger(item.id) || item.id < 1) return [];
    const address = officeAddress(tags);
    const identity = `${name.toLowerCase()}|${address.toLowerCase()}`;
    if (seen.has(identity)) return [];
    const distanceMiles = milesBetween(location, point);
    if (distanceMiles > 25.1) return [];
    seen.add(identity);
    return [{
      name, address, distanceMiles: Math.round(distanceMiles * 10) / 10,
      website: validHttps(tags.website || tags['contact:website'])?.href || '',
      mapUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
      specialty: officeSpecialty(tags),
    }];
  }).sort((left, right) => left.distanceMiles - right.distanceMiles || left.name.localeCompare(right.name)).slice(0, 8);
}

export function createLegalHelpLookup({
  fetchImpl = fetch,
  zipLookupUrl = process.env.RIGHTS_DESK_ZIP_LOOKUP_URL || ZIP_LOOKUP_URL,
  overpassUrl = process.env.RIGHTS_DESK_OVERPASS_URL,
  intervalMs = 1100,
} = {}) {
  const geocodeQueue = createThrottle(intervalMs);
  const officeQueue = createThrottle(intervalMs);
  const locationCache = createCache();
  const officeCache = createCache();
  const inflight = new Map();

  async function geocode(zip) {
    const cached = locationCache.get(zip);
    if (cached !== undefined) return cached;
    const base = validHttps(zipLookupUrl);
    if (!base) throw unavailable();
    base.pathname = base.pathname.replace(/\/?$/, '/');
    let location = null;
    try {
      for (const area of postalRegions(zip)) {
        const url = new URL(`${area}/${zip}`, base);
        location = await geocodeQueue(async () =>
          zipLocation(await fetchJson(fetchImpl, url, 6500, { allowMissing: true }), zip, area)
        );
        if (location) break;
      }
    } catch {
      throw unavailable();
    }
    locationCache.set(zip, location, location ? 7 * 24 * 60 * 60_000 : 60 * 60_000);
    return location;
  }

  async function findOffices(zip, location) {
    const cached = officeCache.get(zip);
    if (cached !== undefined) return cached;
    const isPacificTerritory = ['gu', 'as', 'mp'].includes(postalRegions(zip)[0]);
    const url = validHttps(overpassUrl || (isPacificTerritory ? GLOBAL_OVERPASS_URL : NORTH_AMERICA_OVERPASS_URL));
    if (!url) throw unavailable();
    const query = `[out:json][timeout:6][maxsize:16777216];nwr(${officeSearchArea(location)})["office"="lawyer"]["name"];out center 100;`;
    const offices = await officeQueue(async () => legalOffices(await fetchJson(fetchImpl, url, 8000, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    }), location));
    officeCache.set(zip, offices, 24 * 60 * 60_000);
    return offices;
  }

  return async function nearbyLegalHelp(zip) {
    if (typeof zip !== 'string' || !/^\d{5}$/.test(zip)) {
      throw lookupError(400, 'INVALID_ZIP', 'Enter a five-digit U.S. ZIP code.');
    }
    if (inflight.has(zip)) return inflight.get(zip);
    const lookup = (async () => {
      const location = await geocode(zip);
      if (!location) throw lookupError(404, 'ZIP_NOT_FOUND', 'No map location was found for this ZIP code. Check the ZIP or use a referral directory below.');
      const result = { zip, place: location.place, region: location.region, offices: [], source: 'OpenStreetMap' };
      try {
        result.offices = await findOffices(zip, location);
      } catch {
        result.lookupIncomplete = true;
      }
      return result;
    })().finally(() => inflight.delete(zip));
    inflight.set(zip, lookup);
    return lookup;
  };
}

export const nearbyLegalHelp = createLegalHelpLookup();
