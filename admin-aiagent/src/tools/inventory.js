import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { shopifyAdminRequest } from "../shopifyClient.js";
import { resolveByName } from "../matching.js";

export const CHECK_INVENTORY_LEVEL_SCOPES = ["read_inventory", "read_products", "read_locations"];

async function fetchProductCandidates(productName) {
  const data = await shopifyAdminRequest("products.json", {
    query: { title: productName, limit: 250 },
  });
  return data.products ?? [];
}

async function fetchLocations() {
  const data = await shopifyAdminRequest("locations.json");
  return data.locations ?? [];
}

async function fetchInventoryLevels(inventoryItemIds, locationId) {
  if (inventoryItemIds.length === 0) return [];
  const data = await shopifyAdminRequest("inventory_levels.json", {
    query: {
      inventory_item_ids: inventoryItemIds.join(","),
      location_ids: String(locationId),
    },
  });
  return data.inventory_levels ?? [];
}

export const checkInventoryLevelTool = tool(
  "check_inventory_level",
  "Look up available inventory for a product's variants at a specific location, given the product and location names as they appear in Shopify.",
  {
    productName: z.string().min(1).describe("The product title as it appears in Shopify"),
    locationName: z.string().min(1).describe("The location name as it appears in Shopify"),
  },
  async ({ productName, locationName }) => {
    try {
      const [products, locations] = await Promise.all([
        fetchProductCandidates(productName),
        fetchLocations(),
      ]);

      const product = resolveByName(products, productName, (p) => p.title);
      const location = resolveByName(locations, locationName, (l) => l.name);

      const inventoryItemIds = product.variants.map((v) => v.inventory_item_id);
      const levels = await fetchInventoryLevels(inventoryItemIds, location.id);
      const availableByItemId = new Map(levels.map((l) => [l.inventory_item_id, l.available]));

      const lines = product.variants.map((variant) => {
        const available = availableByItemId.get(variant.inventory_item_id);
        return `- ${variant.title}: ${available ?? "no inventory record"} available`;
      });

      return {
        content: [
          {
            type: "text",
            text: `Inventory for "${product.title}" at "${location.name}":\n${lines.join("\n")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to check inventory: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
