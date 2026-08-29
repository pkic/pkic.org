import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { PermissionGrantCreate, PermissionGrantsList, PermissionGrantRevoke } from "./grants";
import { PermissionSubjectsList } from "./subjects";
import { PermissionTargetsList } from "./targets";
import { requireStaffAnyPermission } from "../../../_lib/auth/staff-permissions";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  await next();
});

// Keep fixed resource routes ahead of any future parameterized permission routes.
openapi.get("/grants", PermissionGrantsList);
openapi.post("/grants", PermissionGrantCreate);
openapi.delete("/grants/:id", PermissionGrantRevoke);
openapi.get("/subjects", PermissionSubjectsList);
openapi.get("/targets", PermissionTargetsList);

export default openapi;
