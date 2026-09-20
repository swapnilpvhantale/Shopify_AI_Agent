import "dotenv/config";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const STORE_DOMAIN = requireEnv("SHOPIFY_STORE_DOMAIN");
export const STOREFRONT_API_VERSION = process.env.SHOPIFY_STOREFRONT_API_VERSION || "2026-07";
export const ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
