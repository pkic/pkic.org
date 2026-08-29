import { z } from "zod";
import { publicOperation } from "./route-contract";

export const apiRootGetRouteSchema = {
  ...publicOperation(),
  tags: ["System"],
  summary: "Get API status",
  description: "Returns the API name, version, documentation URL, and current health status.",
  responses: {
    "200": {
      description: "API status metadata.",
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            version: z.string(),
            docs: z.string(),
            status: z.literal("ok"),
          }),
        },
      },
    },
  },
};
