import { Hono } from "hono";
import { fromHono } from "chanfana";
import { PasskeyRegisterBegin } from "./register-begin";
import { PasskeyRegisterComplete } from "./register-complete";
import { PasskeyAuthenticateBegin } from "./authenticate-begin";
import { PasskeyAuthenticateComplete } from "./authenticate-complete";
import { PasskeysList } from "./index";
import { PasskeyDelete } from "./[id]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/register/begin", PasskeyRegisterBegin);
openapi.post("/register/complete", PasskeyRegisterComplete);
openapi.get("/authenticate/begin", PasskeyAuthenticateBegin);
openapi.post("/authenticate/complete", PasskeyAuthenticateComplete);
openapi.get("/", PasskeysList);
openapi.delete("/:id", PasskeyDelete);

export default openapi;
