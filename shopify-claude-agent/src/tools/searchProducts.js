import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { storefrontRequest } from "../clients/storefrontClient.js";

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($query: String!) {
    products(first: 5, query: $query) {
      edges {
        node {
          title
          variants(first: 1) {
            edges {
              node {
                id
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const inputSchema = {
  // Nullish so a model that omits the arg, or explicitly passes null, both
  // collapse to "" — the Storefront `query` filter never sees null.
  query: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
};

const outputSchema = z.object({
  products: z.array(
    z.object({
      title: z.string(),
      price: z.object({
        amount: z.string(),
        currencyCode: z.string(),
      }),
      variantId: z.string(),
    })
  ),
});

export const searchProductsTool = tool(
  "search_products",
  "Search the storefront catalog by free-text query and return up to 5 matching products with title, price, and variant ID.",
  inputSchema,
  async ({ query }) => {
    const data = await storefrontRequest(SEARCH_PRODUCTS_QUERY, { query });

    const products = data.products.edges
      .map(({ node }) => {
        const variant = node.variants.edges[0]?.node;
        if (!variant) return null;
        return {
          title: node.title,
          price: variant.price,
          variantId: variant.id,
        };
      })
      .filter((product) => product !== null);

    const result = outputSchema.parse({ products });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);
