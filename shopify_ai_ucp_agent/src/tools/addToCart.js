import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { createCart, addItemToCart, cartForModel } from "../clients/cartHelpers.js";
import { registerCart } from "../cartRegistry.js";

const inputSchema = {
  variantId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
};

// Reuses one cart per chat session (sessionState.cart), creating it lazily on
// the first add so multi-turn requests like "add another one" or "also get
// me a blue one" land in the same cart instead of starting a new one.
export function createAddToCartTool(sessionState) {
  return tool(
    "add_to_cart",
    "Add a quantity of one product variant to the shopper's cart for this conversation, creating the cart on first use. Returns the full updated cart (lines, total, checkout URL).",
    inputSchema,
    async ({ variantId, quantity }) => {
      if (!sessionState.cart.id) {
        const created = await createCart();
        sessionState.cart = created;
        // Must be registered as soon as the cart exists — the orders/create
        // webhook routes back to this session via this cart's token, and a
        // cart created here (via chat text) is just as valid as one created
        // through the product card's "Add to Cart" button.
        registerCart(created.id, sessionState.sessionId);
      }

      const updated = await addItemToCart(sessionState.cart.id, variantId, quantity);
      sessionState.cart = updated;

      return {
        content: [{ type: "text", text: JSON.stringify(cartForModel(updated)) }],
      };
    }
  );
}
