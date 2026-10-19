import { Hono } from "hono";
import { fromHono } from "chanfana";
import oauthAuthorizationsRouter from "./oauth/authorizations/router";
import passkeys_Router from "./passkeys/router";
import type { RequestDbContext } from "../../../_lib/db/context";
import { UserAuthRequestLink } from "./request-link";
import { UserAuthVerifyLink } from "./verify-link";
import { UserAuthSession } from "./session";
import { UserAuthLogout } from "./logout";
import { EmailVerificationPost, EmailVerificationPreviewPost } from "./email-verifications";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/oauth/authorizations", oauthAuthorizationsRouter);
openapi.route("/passkeys", passkeys_Router);
openapi.post("/request-link", UserAuthRequestLink);
openapi.post("/verify-link", UserAuthVerifyLink);
openapi.get("/session", UserAuthSession);
openapi.post("/logout", UserAuthLogout);
openapi.post("/email-verifications/preview", EmailVerificationPreviewPost);
openapi.post("/email-verifications", EmailVerificationPost);

export default openapi;
