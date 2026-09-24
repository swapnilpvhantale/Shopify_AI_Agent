import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { searchProductCandidates, getProductDetail } from "../lookups.js";
import { resolveByName } from "../matching.js";

function formatVariant(variant) {
  const levels = variant.inventoryItem.inventoryLevels.edges.map(({ node }) => {
    const available = node.quantities.find((q) => q.name === "available")?.quantity ?? "—";
    return `${node.location.name}: ${available}`;
  });
  return `  - ${variant.title} (${variant.price}) — ${levels.join(", ") || "no inventory tracked"}`;
}

export const getProductTool = tool(
  "get_product",
  "Get full detail for one product by (partial) title: status, vendor, every variant's price, and its inventory at every location. Use this before adjusting inventory or updating the product.",
  {
    productName: z.string().min(1).describe("The product title as it appears in Shopify, or a distinctive substring"),
  },
  async ({ productName }) => {
    try {
      const candidates = await searchProductCandidates(productName);
      const match = resolveByName(candidates, productName, (p) => p.title);
      const product = await getProductDetail(match.id);

      const variantLines = product.variants.edges.map(({ node }) => formatVariant(node));
      const text = [
        `${product.title} [${product.status}] (vendor: ${product.vendor || "—"}, type: ${product.productType || "—"})`,
        ...variantLines,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to get product: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
