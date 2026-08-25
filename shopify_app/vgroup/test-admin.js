import { adminRequest } from "./adminClient.js";

const shop = await adminRequest(`query { shop { name email } }`);
console.log(JSON.stringify(shop, null, 2));

const products = await adminRequest(`
  query {
    products(first: 10) {
      edges {
        node {
          id
          title
          status
          totalInventory
        }
      }
    }
  }
`);
console.log(JSON.stringify(products, null, 2));

const customers = await adminRequest(`
  query {
    customers(first: 10) {
      edges {
        node {
          id
          displayName
          email
          numberOfOrders
        }
      }
    }
  }
`);
console.log(JSON.stringify(customers, null, 2));
