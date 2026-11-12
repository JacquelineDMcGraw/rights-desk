const BASE_URL = 'https://api-m.sandbox.paypal.com';

export class PayPalError extends Error {
  constructor(message, status = 502, code = 'PAYPAL_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let tokenCache = null;

// Authentication alone creates no order and never returns an access token.
export async function verifyPayPalAuthentication() {
  await accessToken();
  return { mode: 'sandbox', authenticated: true, captureVerified: false };
}

async function accessToken() {
  if (!paypalConfigured()) {
    throw new PayPalError('PayPal Sandbox checkout is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.', 503, 'PAYPAL_NOT_CONFIGURED');
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  let response;
  try {
    response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PayPalError('Could not reach PayPal Sandbox.', 502, 'PAYPAL_NETWORK_ERROR');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new PayPalError('PayPal Sandbox rejected the configured API credentials.', 502, 'PAYPAL_AUTH_ERROR');
  }
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 300) * 1000,
  };
  return tokenCache.value;
}

async function api(path, { method = 'GET', body, requestId } = {}) {
  const token = await accessToken();
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new PayPalError('Could not reach PayPal Sandbox.', 502, 'PAYPAL_NETWORK_ERROR');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const name = typeof data.name === 'string' ? data.name : 'PAYPAL_ERROR';
    const message = typeof data.message === 'string' ? data.message : 'PayPal Sandbox request failed.';
    throw new PayPalError(`${message} (${name})`, response.status === 422 ? 409 : 502, name);
  }
  return data;
}

export async function createOrder({ orderId, quote, listing, requestId, baseUrl, returnUrl = `${baseUrl}/?checkout=return&orderId=${encodeURIComponent(orderId)}`, cancelUrl = `${baseUrl}/?checkout=cancel&orderId=${encodeURIComponent(orderId)}`, description = `Rights Desk license: ${listing.title}` }) {
  const data = await api('/v2/checkout/orders', {
    method: 'POST',
    requestId,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: quote.id,
        custom_id: quote.id,
        description: description.slice(0, 127),
        amount: { currency_code: 'USD', value: quote.amount },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Rights Desk',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const approvalUrl = data.links?.find(link => link.rel === 'payer-action' || link.rel === 'approve')?.href;
  if (!data.id || !approvalUrl || !/^https:\/\/(www\.)?sandbox\.paypal\.com\//.test(approvalUrl)) {
    throw new PayPalError('PayPal did not return a usable approval link.', 502, 'PAYPAL_INVALID_ORDER');
  }
  return { paypalOrderId: data.id, approvalUrl, status: data.status };
}

export async function captureOrder(paypalOrderId, requestId) {
  try {
    return await api(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST', body: {}, requestId,
    });
  } catch (error) {
    // A completed capture can precede a lost HTTP response. Read the order
    // instead of allowing a second payment or issuing an unverified license.
    if (error instanceof PayPalError && (error.status === 409 || error.status >= 500)) {
      return await getOrder(paypalOrderId);
    }
    throw error;
  }
}

export async function getOrder(paypalOrderId) {
  return api(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export function verifiedCapture(data, { paypalOrderId, quoteId, amount }) {
  if (data?.id !== paypalOrderId || data.status !== 'COMPLETED') return null;
  const units = data.purchase_units;
  if (!Array.isArray(units) || units.length !== 1 || units[0].reference_id !== quoteId) return null;
  const captures = units[0].payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) return null;
  const capture = captures[0];
  if (capture.status !== 'COMPLETED' || capture.amount?.currency_code !== 'USD' || capture.amount?.value !== amount || !capture.id) return null;
  return capture.id;
}
