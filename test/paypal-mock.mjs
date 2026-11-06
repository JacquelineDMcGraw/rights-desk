// Test-only PayPal transport. The integration test runs its server with --import.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Only this test preloader changes the clock; production has no clock endpoint.
const realNow = Date.now.bind(Date);
if (process.env.RIGHTS_DESK_TEST_CLOCK_PATH) Date.now = () => {
  try { return realNow() + Number(readFileSync(process.env.RIGHTS_DESK_TEST_CLOCK_PATH, 'utf8')); }
  catch { return realNow(); }
};

const realFetch = globalThis.fetch;
const orders = new Map();
const creations = new Map();
const base = 'https://api-m.sandbox.paypal.com';
const reply = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (!url.startsWith(base)) return realFetch(input, options);
  const path = url.slice(base.length);
  if (path === '/v1/oauth2/token') return reply({ access_token: 'test-only-access-token', expires_in: 3600 });
  if (path === '/v2/checkout/orders' && options.method === 'POST') {
    const submitted = JSON.parse(options.body);
    const requestId = options.headers['PayPal-Request-Id'];
    if (creations.has(requestId)) return reply(creations.get(requestId), 201);
    const id = `MOCK-${randomUUID()}`;
    orders.set(id, { unit: submitted.purchase_units[0], captured: false, reads: 0 });
    const result = { id, status: 'CREATED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
    creations.set(requestId, result);
    if (submitted.purchase_units[0].description.includes('Lost checkout')) throw new TypeError('Test lost checkout response');
    return reply(result, 201);
  }
  const capture = /^\/v2\/checkout\/orders\/([A-Za-z0-9-]+)\/capture$/.exec(path);
  const read = /^\/v2\/checkout\/orders\/([A-Za-z0-9-]+)$/.exec(path);
  const id = capture?.[1] || read?.[1];
  const order = id && orders.get(id);
  if (!order) return reply({ name: 'RESOURCE_NOT_FOUND', message: 'Mock order missing' }, 404);
  const scenario = order.unit.description;
  if (capture && options.method === 'POST') {
    if (scenario.includes('Unapproved')) return reply({id, status:'APPROVED'});
    order.captured = true;
    if (scenario.includes('Lost response') || scenario.includes('Uncertain capture')) throw new TypeError('Test lost capture response');
  }
  if (read) {
    order.reads++;
    if (scenario.includes('Uncertain capture') && order.reads === 1) throw new TypeError('Test reconciliation unavailable');
  }
  const amount = {...order.unit.amount};
  if (scenario.includes('Wrong amount')) amount.value = '0.01';
  if (scenario.includes('Wrong currency')) amount.currency_code = 'EUR';
  return reply({
    id: scenario.includes('Wrong order') ? 'OTHER-ORDER' : id,
    status: order.captured ? 'COMPLETED' : 'CREATED',
    purchase_units: [{
      reference_id: scenario.includes('Wrong reference') ? 'OTHER-OFFER' : order.unit.reference_id,
      payments: order.captured ? { captures: [{ id: `CAPTURE-${id}`, status: 'COMPLETED', amount }] } : undefined,
    }],
  });
};
