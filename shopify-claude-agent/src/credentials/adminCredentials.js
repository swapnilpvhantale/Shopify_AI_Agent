import "dotenv/config";
import { STORE_DOMAIN } from "../config.js";

const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
if (!clientId) throw new Error("Missing required environment variable: SHOPIFY_CLIENT_ID");
if (!clientSecret) throw new Error("Missing required environment variable: SHOPIFY_CLIENT_SECRET");

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

export async function getAdminAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  if (!inflightRequest) {
    inflightRequest = requestAccessToken().finally(() => {
      inflightRequest = null;
    });
  }
  return inflightRequest;
}
