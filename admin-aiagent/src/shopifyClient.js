import { STORE_DOMAIN, CLIENT_ID, CLIENT_SECRET, ADMIN_API_VERSION } from "./config.js";

const REFRESH_MARGIN_MS = 60 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let inflightRequest = null;

async function requestAccessToken() {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Shopify OAuth token exchange failed: ${res.status} ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + data.expires_in * 1000 - REFRESH_MARGIN_MS;
  return cachedToken;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  if (!inflightRequest) {
    inflightRequest = requestAccessToken().finally(() => {
      inflightRequest = null;
    });
  }
  return inflightRequest;
}

export async function shopifyAdminRequest(path, { method = "GET", query, body } = {}) {
  const token = await getAccessToken();

  const url = new URL(`https://${STORE_DOMAIN}/admin/api/${ADMIN_API_VERSION}/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Shopify Admin API request failed: ${method} ${path} -> ${res.status} ${text}`);
  }
  return data;
}
