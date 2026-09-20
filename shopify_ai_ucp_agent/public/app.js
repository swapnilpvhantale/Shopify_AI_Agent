const BACKEND_PORT = 3400;
// When opened straight from this server (http://localhost:3400), relative
// URLs already resolve correctly. When opened from a separate static server
// (e.g. VS Code's Live Server on :5500), point at the backend explicitly.
const API_BASE =
  window.location.port === String(BACKEND_PORT)
    ? ""
    : `${window.location.protocol}//${window.location.hostname}:${BACKEND_PORT}`;

const SESSION_KEY = "shopify-chat-session-id";

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const sessionId = getSessionId();
const messagesEl = document.getElementById("messages");
const chatEl = document.getElementById("chat");
const composerEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const cartBarEl = document.getElementById("cart-bar");
const cartLinesEl = document.getElementById("cart-lines");
const cartTotalEl = document.getElementById("cart-total");
const checkoutBtnEl = document.getElementById("checkout-btn");
const accountStatusEl = document.getElementById("account-status");

const authModalBackdrop = document.getElementById("auth-modal-backdrop");
const authModalClose = document.getElementById("auth-modal-close");
const tabLoginEl = document.getElementById("tab-login");
const tabSignupEl = document.getElementById("tab-signup");
const loginFormEl = document.getElementById("login-form");
const signupFormEl = document.getElementById("signup-form");
const loginErrorEl = document.getElementById("login-error");
const signupErrorEl = document.getElementById("signup-error");
const continueAsGuestBtn = document.getElementById("continue-as-guest");

let currentCheckoutUrl = null;
let currentAccount = null;
let skipAuthPrompt = false;

function renderAccountStatus() {
  accountStatusEl.innerHTML = "";

  if (currentAccount) {
    const label = document.createElement("span");
    label.textContent = `Signed in as ${currentAccount.firstName || currentAccount.email}`;
    accountStatusEl.appendChild(label);

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", () => {
      currentAccount = null;
      renderAccountStatus();
    });
    accountStatusEl.appendChild(logoutBtn);
    return;
  }

  const loginBtn = document.createElement("button");
  loginBtn.type = "button";
  loginBtn.textContent = "Log in / Sign up";
  loginBtn.addEventListener("click", () => openAuthModal());
  accountStatusEl.appendChild(loginBtn);
}

function openAuthModal() {
  loginErrorEl.hidden = true;
  signupErrorEl.hidden = true;
  authModalBackdrop.hidden = false;
}

function closeAuthModal() {
  authModalBackdrop.hidden = true;
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  tabLoginEl.classList.toggle("active", isLogin);
  tabSignupEl.classList.toggle("active", !isLogin);
  loginFormEl.hidden = !isLogin;
  signupFormEl.hidden = isLogin;
}

tabLoginEl.addEventListener("click", () => switchAuthTab("login"));
tabSignupEl.addEventListener("click", () => switchAuthTab("signup"));
authModalClose.addEventListener("click", closeAuthModal);
authModalBackdrop.addEventListener("click", (event) => {
  if (event.target === authModalBackdrop) closeAuthModal();
});

function openCheckoutPopup() {
  if (!currentCheckoutUrl) return;
  // Shopify's checkout page refuses to be framed (X-Frame-Options: DENY,
  // frame-ancestors 'none' — a platform-wide security policy we can't
  // override), so it can't be embedded inline. A fixed-size popup is the
  // closest we can get to an in-app feel while still using Shopify's
  // required secure checkout for payment.
  window.open(currentCheckoutUrl, "shopify-checkout", "width=480,height=720,noopener");
}

checkoutBtnEl.addEventListener("click", () => {
  if (!currentCheckoutUrl) return;
  if (currentAccount || skipAuthPrompt) {
    openCheckoutPopup();
  } else {
    openAuthModal();
  }
});

continueAsGuestBtn.addEventListener("click", () => {
  skipAuthPrompt = true;
  closeAuthModal();
  openCheckoutPopup();
});

loginFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginErrorEl.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const submitBtn = loginFormEl.querySelector(".auth-submit");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not log in.");

    currentAccount = data.customer;
    renderAccountStatus();
    renderCart(data.cart);
    closeAuthModal();
    openCheckoutPopup();
  } catch (err) {
    loginErrorEl.textContent = err.message;
    loginErrorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

signupFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  signupErrorEl.hidden = true;
  const firstName = document.getElementById("signup-first-name").value.trim();
  const lastName = document.getElementById("signup-last-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const submitBtn = signupFormEl.querySelector(".auth-submit");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, email, password, firstName, lastName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create an account.");

    currentAccount = data.customer;
    renderAccountStatus();
    renderCart(data.cart);
    closeAuthModal();
    openCheckoutPopup();
  } catch (err) {
    signupErrorEl.textContent = err.message;
    signupErrorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

renderAccountStatus();

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addBubble(text, role) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function addTypingBubble() {
  const bubble = document.createElement("div");
  bubble.className = "bubble assistant typing";
  bubble.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

async function addToCartRequest(variantId, quantity) {
  const res = await fetch(`${API_BASE}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, variantId, quantity }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not add that item to the cart.");
  return data.cart;
}

function renderProductCards(products) {
  if (!products || products.length === 0) return;

  const grid = document.createElement("div");
  grid.className = "product-cards";

  for (const product of products) {
    const card = document.createElement("div");
    card.className = "product-card";

    if (product.imageUrl) {
      const img = document.createElement("img");
      img.src = product.imageUrl;
      img.alt = product.title;
      card.appendChild(img);
    }

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = product.title;
    card.appendChild(title);

    const variants = (product.variants || []).filter((v) => v.availableForSale);
    const firstVariant = product.variants?.[0];
    if (firstVariant) {
      const price = document.createElement("div");
      price.className = "price";
      price.textContent = `${firstVariant.price.amount} ${firstVariant.price.currencyCode}`;
      card.appendChild(price);
    }

    if (!product.availableForSale || variants.length === 0) {
      const oos = document.createElement("div");
      oos.className = "oos";
      oos.textContent = "Out of stock";
      card.appendChild(oos);
      grid.appendChild(card);
      continue;
    }

    let select = null;
    if (variants.length > 1) {
      select = document.createElement("select");
      select.className = "variant-select";
      for (const variant of variants) {
        const option = document.createElement("option");
        option.value = variant.variantId;
        option.textContent = variant.title;
        select.appendChild(option);
      }
      card.appendChild(select);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "add-to-cart-btn";
    addBtn.textContent = "Add to Cart";
    addBtn.addEventListener("click", async () => {
      const variantId = select ? select.value : variants[0].variantId;
      addBtn.disabled = true;
      const originalText = addBtn.textContent;
      addBtn.textContent = "Adding...";
      try {
        const cart = await addToCartRequest(variantId, 1);
        renderCart(cart);
        addBtn.textContent = "Added ✓";
        setTimeout(() => {
          addBtn.textContent = originalText;
          addBtn.disabled = false;
        }, 1200);
      } catch (err) {
        addBtn.textContent = "Failed — retry";
        addBtn.disabled = false;
      }
    });
    card.appendChild(addBtn);

    grid.appendChild(card);
  }

  messagesEl.appendChild(grid);
  scrollToBottom();
}

function renderCheckoutButton() {
  const wrap = document.createElement("div");
  wrap.className = "checkout-prompt";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "checkout-prompt-btn";
  btn.textContent = "Complete Payment";
  btn.addEventListener("click", () => {
    if (currentAccount || skipAuthPrompt) {
      openCheckoutPopup();
    } else {
      openAuthModal();
    }
  });

  wrap.appendChild(btn);
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function renderCart(cart) {
  if (!cart || !cart.lines || cart.lines.length === 0) {
    cartBarEl.hidden = true;
    currentCheckoutUrl = null;
    return;
  }

  cartLinesEl.innerHTML = "";
  for (const line of cart.lines) {
    const row = document.createElement("div");
    row.className = "cart-line";

    const name = document.createElement("span");
    name.className = "cart-line-name";
    name.textContent = `${line.productTitle}${line.variantTitle !== "Default Title" ? ` (${line.variantTitle})` : ""} × ${line.quantity}`;
    row.appendChild(name);

    const price = document.createElement("span");
    price.className = "cart-line-price";
    price.textContent = `${(Number(line.price.amount) * line.quantity).toFixed(2)} ${line.price.currencyCode}`;
    row.appendChild(price);

    cartLinesEl.appendChild(row);
  }

  cartTotalEl.textContent = `Total: ${cart.totalAmount} ${cart.currencyCode}`;
  currentCheckoutUrl = cart.checkoutUrl;
  cartBarEl.hidden = false;
}

async function sendMessage(text) {
  addBubble(text, "user");
  inputEl.value = "";
  inputEl.disabled = true;
  composerEl.querySelector("button").disabled = true;

  const thinking = addTypingBubble();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });

    const data = await res.json();

    thinking.remove();

    if (!res.ok) {
      addBubble(data.error || "Something went wrong.", "error");
      return;
    }

    addBubble(data.reply || "(no response)", "assistant");
    renderProductCards(data.products);
    renderCart(data.cart);

    // Browsers block window.open() called from an async callback like this
    // one (it's no longer considered a direct result of the user's click),
    // so instead of trying to auto-open checkout, render a real button the
    // shopper clicks themselves — that click is a fresh user gesture, so
    // the popup isn't blocked.
    if (data.checkoutRequested && currentCheckoutUrl) {
      renderCheckoutButton();
    }
  } catch (err) {
    thinking.remove();
    addBubble("Network error — is the server running?", "error");
  } finally {
    inputEl.disabled = false;
    composerEl.querySelector("button").disabled = false;
    inputEl.focus();
  }
}

composerEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  sendMessage(text);
});

addBubble(
  "Hi! Ask me about products in the store, or tell me what you'd like to buy.",
  "assistant"
);

// Listens for the orders/create webhook (relayed by the server) so the
// order confirmation appears in the chat the moment payment completes in
// the checkout popup, without the shopper having to say anything.
function connectOrderNotifications() {
  const source = new EventSource(`${API_BASE}/api/chat/stream/${sessionId}`);

  source.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "order_confirmed") {
      addBubble(
        `🎉 Order ${data.orderName} confirmed — ${data.totalPrice} ${data.currency} paid. Thank you!`,
        "assistant"
      );
      renderCart(null);
    }
  };

  source.onerror = () => {
    // The browser retries EventSource connections automatically; nothing
    // to do here beyond letting it reconnect.
  };
}

connectOrderNotifications();
