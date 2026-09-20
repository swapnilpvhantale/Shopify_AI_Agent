import { tool } from "@anthropic-ai/claude-agent-sdk";
import { fetchCart, cartForModel } from "../clients/cartHelpers.js";

export function createGetCartTool(sessionState) {
  return tool(
    "get_cart",
    "Get the current contents of the shopper's cart for this conversation: line items, quantities, total price, and checkout URL. Returns empty:true if no cart has been started yet.",
    {},
    async () => {
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
