import "dotenv/config";
import { STORE_DOMAIN } from "../config.js";

const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

if (!staticToken && (!clientId || !clientSecret)) {
  throw new Error(
    "Missing Shopify admin credentials: set SHOPIFY_ADMIN_ACCESS_TOKEN, or both SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET."
  );
}

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let inflightRequest = null;

async function requestAccessToken() {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Admin token exchange failed: ${JSON.stringify(data)}`);
  }

  const lifetimeMs = data.expires_in ? data.expires_in * 1000 : TOKEN_LIFETIME_MS;
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + lifetimeMs - REFRESH_MARGIN_MS;
  return cachedToken;
}

// Prefers a static custom-app access token (SHOPIFY_ADMIN_ACCESS_TOKEN) when
// set, since that's the simplest path for a single-store admin tool; falls
// back to the client-credentials OAuth exchange otherwise.
export async function getAdminAccessToken() {
  if (staticToken) return staticToken;

  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  if (!inflightRequest) {
    inflightRequest = requestAccessToken().finally(() => {
      inflightRequest = null;
    });
  }
  return inflightRequest;
}
