const { getAllCustomers, getAllOrders, getAllInventoryLevels } = require("./queries");

async function main() {
  const customers = await getAllCustomers();
  console.log("=== Customers ===");
  console.log(JSON.stringify(customers, null, 2));
  console.log(`Total customers: ${customers.length}\n`);

  const orders = await getAllOrders();
  console.log("=== Orders ===");
  console.log(JSON.stringify(orders, null, 2));
  console.log(`Total orders: ${orders.length}\n`);

  const inventory = await getAllInventoryLevels();
  console.log("=== Inventory ===");
  console.log(JSON.stringify(inventory, null, 2));
  console.log(`Total products: ${inventory.length}`);
}

main().catch(console.error);
