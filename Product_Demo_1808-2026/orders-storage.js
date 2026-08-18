const ORDERS_KEY = 'purchasedOrders';

export function getOrders() {
  const raw = localStorage.getItem(ORDERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function addOrder(product) {
  const orders = getOrders();
  orders.push({
    id: product.id,
    name: product.name,
    image: product.image,
    price: product.price,
    purchasedAt: new Date().toISOString(),
  });
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}
