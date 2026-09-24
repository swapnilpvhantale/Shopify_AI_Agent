import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest, assertNoUserErrors } from "../clients/adminClient.js";
import { searchProductCandidates, getProductDetail } from "../lookups.js";
import { resolveByName } from "../matching.js";
import { requireApproval } from "../approval.js";

const PRODUCT_UPDATE_MUTATION = `
  mutation UpdateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title status }
      userErrors { field message }
    }
  }
`;

const VARIANT_PRICE_MUTATION = `
  mutation UpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

// Wraps update_product's session-scoped role check and dispatches to
// productUpdate (title/status) and/or productVariantsBulkUpdate (price),
// since Shopify's Admin API splits those across two mutations.
export function createUpdateProductTool(sessionState) {
  return tool(
    "update_product",
    "Update a product's title, status (active/draft/archived), and/or a variant's price. This is a real write against the store - it requires the operator to explicitly confirm the change first. Only the fields provided are changed.",
    {
      productName: z.string().min(1).describe("The product title, or a distinctive substring"),
      newTitle: z.string().optional().default("").describe("New title, if changing it"),
      newStatus: z.enum(["active", "draft", "archived", ""]).optional().default("").describe("New status, if changing it"),
      variantName: z.string().optional().default("").describe("Variant title to reprice, if the product has more than one variant"),
      newPrice: z.string().optional().default("").describe('New price for the variant, e.g. "29.99", if changing it'),
      confirmed: z.boolean().describe("Whether the operator has explicitly confirmed this change"),
    },
    async ({ productName, newTitle, newStatus, variantName, newPrice, confirmed }) => {
      const approval = requireApproval({ role: sessionState.role, confirmed });
      if (!approval.approved) {
        return {
          content: [{ type: "text", text: `Approval denied: ${approval.reason}` }],
          isError: true,
        };
      }

      if (!newTitle && !newStatus && !newPrice) {
        return {
          content: [{ type: "text", text: "Nothing to update: provide newTitle, newStatus, and/or newPrice." }],
          isError: true,
        };
      }

      try {
        const candidates = await searchProductCandidates(productName);
        const match = resolveByName(candidates, productName, (p) => p.title);
        const changes = [];

        if (newTitle || newStatus) {
          const input = { id: match.id };
          if (newTitle) input.title = newTitle;
          if (newStatus) input.status = newStatus.toUpperCase();
          const data = await adminRequest(PRODUCT_UPDATE_MUTATION, { input });
          assertNoUserErrors(data.productUpdate.userErrors, "Failed to update product");
          if (newTitle) changes.push(`title -> "${newTitle}"`);
          if (newStatus) changes.push(`status -> ${newStatus}`);
        }

        if (newPrice) {
          const product = await getProductDetail(match.id);
          const variants = product.variants.edges.map((e) => e.node);
          const variant =
            variantName && variantName.trim()
              ? resolveByName(variants, variantName, (v) => v.title)
              : variants.length === 1
                ? variants[0]
                : (() => {
                    throw new Error(
                      `"${match.title}" has multiple variants (${variants.map((v) => v.title).join(", ")}); specify variantName.`
                    );
                  })();

          const data = await adminRequest(VARIANT_PRICE_MUTATION, {
            productId: match.id,
            variants: [{ id: variant.id, price: newPrice }],
          });
          assertNoUserErrors(data.productVariantsBulkUpdate.userErrors, "Failed to update price");
          changes.push(`${variant.title} price -> ${newPrice}`);
        }

        const summary = `Updated "${match.title}": ${changes.join(", ")}.`;
        sessionState.actionsThisTurn?.push({ tool: "update_product", summary });
        return { content: [{ type: "text", text: summary }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to update product: ${error.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } }
  );
}
