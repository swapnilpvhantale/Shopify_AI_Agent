import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { searchLocations } from "../lookups.js";

export const listLocationsTool = tool(
  "list_locations",
  "List every inventory location configured for this store (warehouses, retail stores, etc). Use this to find the exact location name to pass to other tools.",
  {},
  async () => {
    try {
      const locations = await searchLocations();
      const text = locations
        .map((l) => `- ${l.name}${l.isActive ? "" : " (inactive)"}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No locations found." }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to list locations: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
