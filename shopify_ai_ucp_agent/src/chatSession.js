import { query } from "@anthropic-ai/claude-agent-sdk";
import { createShopifyMcpServer, SHOPIFY_MCP_SERVER_NAME, ALLOWED_TOOLS } from "./mcpServer.js";
import { createCart, addItemToCart, setCartBuyerIdentity } from "./clients/cartHelpers.js";
import { signUp, logIn } from "./clients/customerAuth.js";
import { registerCart } from "./cartRegistry.js";

const SYSTEM_PROMPT = [
  "You are a shopping assistant for a Shopify store.",
  "Answer questions about products (availability, price, variants like size/color, descriptions) using search_products, and manage the shopper's cart/checkout using add_to_cart, update_cart_item, and get_cart.",
  "Always look products up before answering about them or adding them to cart — never guess prices, availability, or variant IDs.",
  "add_to_cart only ever increases quantity. If the shopper wants fewer of something already in the cart, an exact quantity, or to remove an item, use update_cart_item instead — check get_cart first if you don't already know the item's variantId.",
  "As soon as the shopper asks to check out, pay, or complete their order, call begin_checkout (even if you already know what's in the cart) — the app uses that call to show them a real 'Complete Payment' button, so don't skip it.",
  "Never paste the checkoutUrl itself in your reply — the app already renders a payment button whenever begin_checkout runs. Just confirm the order total in plain text.",
  "You cannot take payment yourself.",
  "If the shopper asks about a past order or order status, use get_orders. If it returns not_logged_in, tell them they need to log in to view order history — don't guess or make up order details.",
  "Keep answers short and plain: a sentence or two, or a compact list only when comparing several items. No markdown tables, no headers, no unsolicited upsells or category suggestions.",
  "Stay focused on this store's products and the shopper's cart/checkout.",
].join(" ");

// One ChatSession wraps one persistent Claude Agent SDK `query()` conversation
// so multi-turn context (and the cart tools' sessionState) survives across
// HTTP requests for the same browser session. Turns are fed through a queue
// instead of readline, and serialized with a lock so two requests for the
// same session can't interleave into the same SDK stream.
export function createChatSession(sessionId) {
  const sessionState = {
    sessionId,
    cart: { id: null, checkoutUrl: null, lines: [] },
    lastProducts: [],
    customer: null,
    checkoutRequested: false,
  };

  // Every place that gets a fresh cart from Shopify goes through this so the
  // cartToken -> sessionId registry (used to route the orders/create webhook
  // back to the right chat) never falls out of sync with sessionState.cart.
  function setCart(cart) {
    sessionState.cart = cart;
    registerCart(cart.id, sessionId);
  }

  const mcpServer = createShopifyMcpServer(sessionState);

  const pending = [];
  let wake = null;

  async function* inputGenerator() {
    while (true) {
      if (pending.length === 0) {
        await new Promise((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield pending.shift();
    }
  }

  function pushUserMessage(text) {
    pending.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    if (wake) {
      const resolve = wake;
      wake = null;
      resolve();
    }
  }

  const sdkSession = query({
    prompt: inputGenerator(),
    options: {
      systemPrompt: { type: "custom", prompt: SYSTEM_PROMPT },
      mcpServers: { [SHOPIFY_MCP_SERVER_NAME]: mcpServer },
      allowedTools: ALLOWED_TOOLS,
    },
  });
  const messages = sdkSession[Symbol.asyncIterator]();

  let lock = Promise.resolve();

  async function runTurnUnlocked(text) {
    sessionState.lastProducts = [];
    sessionState.checkoutRequested = false;
    pushUserMessage(text);

    const replyParts = [];
    while (true) {
      const { value: message, done } = await messages.next();
      if (done) break;

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            replyParts.push(block.text.trim());
          }
        }
      } else if (message.type === "result") {
        if (message.subtype !== "success") {
          replyParts.push(`(turn ended: ${message.subtype})`);
        }
        break;
      }
    }

    return {
      reply: replyParts.join("\n\n"),
      products: sessionState.lastProducts,
      cart: sessionState.cart.id ? sessionState.cart : null,
      checkoutRequested: sessionState.checkoutRequested,
    };
  }

  // Runs `fn` after any turn/cart-mutation already in flight for this
  // session, so a product-card "Add to Cart" click can't race a chat turn
  // that's also touching sessionState.cart.
  function withLock(fn) {
    const result = lock.then(fn);
    // Swallow rejections here so a failed call doesn't wedge the lock for
    // the next one; the caller still sees the original rejection below.
    lock = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  function runTurn(text) {
    return withLock(() => runTurnUnlocked(text));
  }

  // Adds an item straight to the session's cart without going through
  // Claude — used by the product card's "Add to Cart" button, where the
  // variant and quantity are already known and an LLM round-trip would
  // just add latency for a deterministic action.
  function addToCart(variantId, quantity) {
    return withLock(async () => {
      if (!sessionState.cart.id) {
        setCart(await createCart());
      }
      setCart(await addItemToCart(sessionState.cart.id, variantId, quantity));
      return sessionState.cart;
    });
  }

  // Shared by signUp/logIn: once we have a customer session, attach it to
  // the cart (creating the cart first if the shopper hasn't added anything
  // yet) so checkout opens already signed in instead of as a guest.
  async function attachCustomer(session) {
    sessionState.customer = {
      email: session.email,
      firstName: session.firstName,
      accessToken: session.accessToken,
    };

    if (!sessionState.cart.id) {
      setCart(await createCart());
    }
    setCart(
      await setCartBuyerIdentity(sessionState.cart.id, {
        customerAccessToken: session.accessToken,
        email: session.email,
      })
    );

    return { customer: { email: session.email, firstName: session.firstName }, cart: sessionState.cart };
  }

  function signUpCustomer({ email, password, firstName, lastName }) {
    return withLock(async () => {
      const session = await signUp({ email, password, firstName, lastName });
      return attachCustomer(session);
    });
  }

  function logInCustomer({ email, password }) {
    return withLock(async () => {
      const session = await logIn({ email, password });
      return attachCustomer(session);
    });
  }

  // Called once the orders/create webhook confirms this session's cart was
  // actually paid for. Shopify's Storefront cart is consumed by checkout —
  // fetching it afterward still returns its old pre-checkout line items and
  // subtotal (not the final, tax/shipping-included order total) — so without
  // this, the next chat turn or get_cart call would resurrect a stale cart
  // bar for an order that's already done.
  function clearCart() {
    return withLock(() => {
      sessionState.cart = { id: null, checkoutUrl: null, lines: [] };
    });
  }

  return { runTurn, addToCart, signUpCustomer, logInCustomer, clearCart };
}
