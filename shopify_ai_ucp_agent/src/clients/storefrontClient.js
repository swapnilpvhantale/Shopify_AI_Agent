import { STORE_DOMAIN, STOREFRONT_API_VERSION } from "../config.js";
import { STOREFRONT_PRIVATE_TOKEN } from "../credentials/storefrontCredentials.js";

export async function storefrontRequest(query, variables = {}) {
  const res = await fetch(`https://${STORE_DOMAIN}/api/${STOREFRONT_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Shopify-Storefront-Private-Token": STOREFRONT_PRIVATE_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Storefront API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}
