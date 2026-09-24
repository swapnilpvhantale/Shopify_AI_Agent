import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest, assertNoUserErrors } from "../clients/adminClient.js";
import { searchProductCandidates, getProductDetail, searchLocations } from "../lookups.js";
import { resolveByName } from "../matching.js";
import { requireApproval } from "../approval.js";

// This API version requires an @idempotent directive on the mutation (a
// fresh key per call - it's not a dedupe key we want to reuse), or Shopify
// rejects the request outright with "The @idempotent directive is required".
const SET_QUANTITIES_MUTATION = `
  mutation SetInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        changes { name delta quantityAfterChange }
      }
      userErrors { field message }
    }
  }
`;

// Wraps update_inventory's session-scoped role check and the mutation call so
// the tool body itself just orchestrates lookups.
export function createUpdateInventoryTool(sessionState) {
  return tool(
    "update_inventory",
    "Set the available inventory quantity for a product variant at a specific location to an exact number. This is a real write against the store - it requires the operator to explicitly confirm the change first.",
    {
      productName: z.string().min(1).describe("The product title, or a distinctive substring"),
      variantName: z
        .string()
        .optional()
        .default("")
        .describe("The variant title (e.g. size/color), if the product has more than one variant"),
      locationName: z.string().min(1).describe("The location name as it appears in Shopify"),
      quantity: z.number().int().min(0).describe("The exact available quantity to set"),
      confirmed: z.boolean().describe("Whether the operator has explicitly confirmed this change"),
    },
    async ({ productName, variantName, locationName, quantity, confirmed }) => {
      const approval = requireApproval({ role: sessionState.role, confirmed });
      if (!approval.approved) {
        return {
          content: [{ type: "text", text: `Approval denied: ${approval.reason}` }],
          isError: true,
        };
      }

      try {
        const [candidates, locations] = await Promise.all([
          searchProductCandidates(productName),
          searchLocations(),
        ]);
        const productMatch = resolveByName(candidates, productName, (p) => p.title);
        const location = resolveByName(locations, locationName, (l) => l.name);

        const product = await getProductDetail(productMatch.id);
        const variants = product.variants.edges.map((e) => e.node);
        const variant =
          variantName && variantName.trim()
            ? resolveByName(variants, variantName, (v) => v.title)
            : variants.length === 1
              ? variants[0]
              : (() => {
                  throw new Error(
                    `"${product.title}" has multiple variants (${variants.map((v) => v.title).join(", ")}); specify variantName.`
                  );
                })();

        const currentLevel = variant.inventoryItem.inventoryLevels.edges.find(
          ({ node }) => node.location.id === location.id
        );
        const changeFromQuantity =
          currentLevel?.node.quantities.find((q) => q.name === "available")?.quantity ?? 0;

        const data = await adminRequest(SET_QUANTITIES_MUTATION, {
          input: {
            name: "available",
            reason: "correction",
            quantities: [
              {
                inventoryItemId: variant.inventoryItem.id,
                locationId: location.id,
                quantity,
                // Required by this API version: the quantity Shopify should
                // see as the starting point, so a concurrent edit elsewhere
                // doesn't get silently clobbered by this write.
                changeFromQuantity,
              },
            ],
          },
          idempotencyKey: crypto.randomUUID(),
        });
        assertNoUserErrors(
          data.inventorySetQuantities.userErrors,
          "Failed to update inventory"
        );

        const summary = `Set "${product.title}" (${variant.title}) at "${location.name}" to ${quantity} available.`;
        sessionState.actionsThisTurn?.push({ tool: "update_inventory", summary });

        return { content: [{ type: "text", text: summary }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to update inventory: ${error.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } }
  );
}
