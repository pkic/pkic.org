import { Hono } from "hono";
import { fromHono } from "chanfana";
import { OrganizationsList } from "./index";
import content_reviews_Router from "./content-reviews/router";
import id_Router from "./[id]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationsList);
// Must be registered before "/:id" — "content-reviews" would otherwise be
// swallowed as an :id value on some router implementations.
openapi.route("/content-reviews", content_reviews_Router);
openapi.route("/:id", id_Router);

export default openapi;
