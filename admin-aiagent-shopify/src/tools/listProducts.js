import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { searchProductCandidates } from "../lookups.js";

function formatProduct(product) {
  const min = product.priceRangeV2.minVariantPrice;
  const max = product.priceRangeV2.maxVariantPrice;
  const priceText =
    min.amount === max.amount
      ? `${min.amount} ${min.currencyCode}`
      : `${min.amount}-${max.amount} ${min.currencyCode}`;
  return `- ${product.title} [${product.status}] — ${priceText}, ${product.totalInventory} in stock (vendor: ${product.vendor || "—"})`;
}

export const listProductsTool = tool(
  "list_products",
  "Search or list products in the store by (partial) title, with status, price range, and total inventory across all locations. Use this to find a product before inspecting or changing it.",
  {
    searchTerm: z
      .string()
      .optional()
      .default("")
      .describe("Partial or full product title to filter by. Leave empty to list recent products."),
    limit: z.number().int().min(1).max(100).optional().default(30),
  },
  async ({ searchTerm, limit }) => {
    try {
      const products = await searchProductCandidates(searchTerm, limit);
      if (products.length === 0) {
        return { content: [{ type: "text", text: "No products matched." }] };
      }
      return {
        content: [{ type: "text", text: products.map(formatProduct).join("\n") }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to list products: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
