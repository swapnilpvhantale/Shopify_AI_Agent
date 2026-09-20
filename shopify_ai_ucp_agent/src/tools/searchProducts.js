import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { storefrontRequest } from "../clients/storefrontClient.js";

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($query: String!) {
    products(first: 5, query: $query) {
      edges {
        node {
          title
          description(truncateAt: 200)
          availableForSale
          featuredImage {
            url
          }
          variants(first: 6) {
            edges {
              node {
                id
                title
                availableForSale
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

const variantSchema = z.object({
  variantId: z.string(),
  title: z.string(),
  availableForSale: z.boolean(),
  price: z.object({
    amount: z.string(),
    currencyCode: z.string(),
  }),
});

const outputSchema = z.object({
  products: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      availableForSale: z.boolean(),
      imageUrl: z.string().nullable(),
      variants: z.array(variantSchema),
    })
  ),
});

// sessionState.lastProducts is read by the chat server right after the turn
// so the frontend can render product cards without re-parsing tool output.
export function createSearchProductsTool(sessionState) {
  return tool(
    "search_products",
    "Search the storefront catalog by free-text query and return up to 5 matching products with description, availability, image, and variants (with price and per-variant availability) so questions about size/color/stock can be answered.",
    inputSchema,
    async ({ query }) => {
      const data = await storefrontRequest(SEARCH_PRODUCTS_QUERY, { query });

      const products = data.products.edges.map(({ node }) => ({
        title: node.title,
        description: node.description,
        availableForSale: node.availableForSale,
        imageUrl: node.featuredImage?.url ?? null,
        variants: node.variants.edges.map(({ node: variant }) => ({
          variantId: variant.id,
          title: variant.title,
          availableForSale: variant.availableForSale,
          price: variant.price,
        })),
      }));

      const result = outputSchema.parse({ products });
      sessionState.lastProducts = result.products;

      // The model never needs imageUrl (it's only for the frontend's product
      // cards) or an empty description string — dropping them, and skipping
      // JSON.stringify's pretty-print indentation, meaningfully shrinks what
      // gets fed back into (and kept in) the conversation.
      const forModel = {
        products: result.products.map((product) => {
          const { title, availableForSale, variants, description } = product;
          return {
            title,
            availableForSale,
            variants,
            ...(description ? { description } : {}),
          };
        }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(forModel) }],
      };
    }
  );
}
