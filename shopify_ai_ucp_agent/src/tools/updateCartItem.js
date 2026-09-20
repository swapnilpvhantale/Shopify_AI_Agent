import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { setLineQuantity, cartForModel } from "../clients/cartHelpers.js";

const inputSchema = {
  variantId: z.string().min(1),
  quantity: z
    .number()
    .int()
    .min(0)
    .describe("The exact quantity to set this line to. Use 0 to remove it entirely."),
};

export function createUpdateCartItemTool(sessionState) {
  return tool(
    "update_cart_item",
    "Set an item already in the cart to an exact quantity, or remove it (quantity: 0). Use this for 'I only want one', 'remove the shorts', 'make it 3' — never call add_to_cart to reduce a quantity, it only adds.",
    inputSchema,
    async ({ variantId, quantity }) => {
      if (!sessionState.cart.id) {
        return {
          content: [{ type: "text", text: JSON.stringify({ empty: true }) }],
        };
      }

      const updated = await setLineQuantity(sessionState.cart.id, variantId, quantity);
      sessionState.cart = updated ?? { id: null, checkoutUrl: null, lines: [] };

      return {
        content: [
          { type: "text", text: JSON.stringify(updated ? cartForModel(updated) : { empty: true }) },
        ],
      };
    }
  );
}
