import { tool } from "@anthropic-ai/claude-agent-sdk";
import { fetchCart, cartForModel } from "../clients/cartHelpers.js";

// Doesn't mutate anything Shopify-side — it just flags this turn as a
// checkout request so the server can tell the frontend to open the checkout
// popup itself, instead of the shopper having to click the cart bar's button
// after asking for checkout in the chat.
export function createBeginCheckoutTool(sessionState) {
  return tool(
    "begin_checkout",
    "Call this as soon as the shopper asks to check out, pay, or complete their order. Returns the current cart; empty:true if there's nothing in it yet.",
    {},
    async () => {
      sessionState.checkoutRequested = true;

      if (!sessionState.cart.id) {
        return {
          content: [{ type: "text", text: JSON.stringify({ empty: true }) }],
        };
      }

      const cart = await fetchCart(sessionState.cart.id);
      sessionState.cart = cart ?? { id: null, checkoutUrl: null, lines: [] };

      return {
        content: [
          { type: "text", text: JSON.stringify(cart ? cartForModel(cart) : { empty: true }) },
        ],
      };
    }
  );
}
