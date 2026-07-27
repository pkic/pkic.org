import { Hono } from "hono";
import { fromHono } from "chanfana";
import { OrganizationContentReviewGet } from "./index";
import { OrganizationContentReviewApprovePost } from "./approve";
import { OrganizationContentReviewRejectPost } from "./reject";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OrganizationContentReviewGet);
openapi.post("/approve", OrganizationContentReviewApprovePost);
openapi.post("/reject", OrganizationContentReviewRejectPost);

export default openapi;
