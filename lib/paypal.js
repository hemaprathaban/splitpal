// PayPal REST (Orders v2) client for the sandbox environment.
// Each friend's share becomes its own PayPal order that they approve and pay.

const BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

// A PayPal client ID is a long run of letters, digits, "-" and "_". Anything else
// (e.g. a pasted "KEY=value" line) is rejected so it is never sent to browsers.
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;
const clientId = () => (process.env.PAYPAL_CLIENT_ID || "").trim();
const clientIdValid = () => CLIENT_ID_RE.test(clientId());
const paypalEnabled = () => Boolean(clientIdValid() && (process.env.PAYPAL_CLIENT_SECRET || "").trim());
if (process.env.PAYPAL_CLIENT_ID && !clientIdValid()) {
  console.warn("PAYPAL_CLIENT_ID does not look like a PayPal client ID; PayPal is disabled until it is fixed.");
}

let cachedToken = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const auth = Buffer.from(`${clientId()}:${process.env.PAYPAL_CLIENT_SECRET.trim()}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function call(method, path, body, idempotencyKey) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["PayPal-Request-Id"] = idempotencyKey;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.details?.[0]?.description || json.message || res.statusText;
    throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return json;
}

/** Create an order for one person's share. */
async function createOrder({ amount, currency, description, referenceId, payeeEmail }) {
  const unit = {
    reference_id: referenceId,
    description: description.slice(0, 127),
    amount: { currency_code: currency, value: amount },
  };
  if (payeeEmail) unit.payee = { email_address: payeeEmail };
  return call(
    "POST",
    "/v2/checkout/orders",
    { intent: "CAPTURE", purchase_units: [unit] },
    `splitpal-${referenceId}`,
  );
}

async function captureOrder(orderId) {
  return call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);
}

async function getOrder(orderId) {
  return call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

module.exports = { createOrder, captureOrder, getOrder, paypalEnabled, clientId };
