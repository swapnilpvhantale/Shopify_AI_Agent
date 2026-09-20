import "dotenv/config";

const token = process.env.STOREFRONT_PRIVATE_TOKEN;
if (!token) throw new Error("Missing required environment variable: STOREFRONT_PRIVATE_TOKEN");

export const STOREFRONT_PRIVATE_TOKEN = token;
