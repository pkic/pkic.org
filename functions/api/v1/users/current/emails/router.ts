import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import {
  OwnEmailAddressDelete,
  OwnEmailAddressPatch,
  OwnEmailAddressPost,
  OwnEmailAddressVerificationPost,
  OwnEmailAddressesGet,
} from "./index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", OwnEmailAddressesGet);
openapi.post("/", OwnEmailAddressPost);
openapi.patch("/:emailId", OwnEmailAddressPatch);
openapi.delete("/:emailId", OwnEmailAddressDelete);
openapi.post("/:emailId/verification", OwnEmailAddressVerificationPost);

export default openapi;
