import type { Context, Hono, Next } from "hono";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type RequestDbContext } from "../../../../_lib/db/context";

async function requireEventManagementIdentity(c: Context<RequestDbContext>, next: Next) {
  await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await next();
}

/** Register management identity checks after the public form placement route. */
export function registerEventManagementAuthentication(app: Hono<RequestDbContext>): void {
  app.use("/settings", requireEventManagementIdentity);
  app.use("/agenda/transfers", requireEventManagementIdentity);
  app.use("/agenda/transfers/*", requireEventManagementIdentity);
  app.use("/agenda/occurrences/filters", requireEventManagementIdentity);
  app.use("/days", async (c, next) => {
    // The read use case combines live authentication with its complete resource snapshot.
    // Writes retain the existing identity check before body validation.
    if (c.req.method === "GET" || c.req.method === "HEAD") await next();
    else await requireEventManagementIdentity(c, next);
  });
  app.use("/team", requireEventManagementIdentity);
  app.use("/roles", requireEventManagementIdentity);
  app.use("/roles/*", requireEventManagementIdentity);
  app.use("/promoters", requireEventManagementIdentity);
  app.use("/presentations/archive", requireEventManagementIdentity);
  app.use("/analytics", requireEventManagementIdentity);
  app.use("/recordings", requireEventManagementIdentity);
  app.use("/recordings/*", requireEventManagementIdentity);
  app.use("/email", requireEventManagementIdentity);
  app.use("/email/*", requireEventManagementIdentity);

  app.use("/forms", requireEventManagementIdentity);
  app.use("/forms/*", requireEventManagementIdentity);
}
