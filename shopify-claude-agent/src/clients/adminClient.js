import { STORE_DOMAIN, ADMIN_API_VERSION } from "../config.js";
import { getAdminAccessToken } from "../credentials/adminCredentials.js";

export async function adminRequest(query, variables = {}) {
  const accessToken = await getAdminAccessToken();
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Admin API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}
