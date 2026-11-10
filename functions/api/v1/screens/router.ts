import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ScreenGet, ScreenPatch } from "./[screenId]";
import { ScreenPairingPost } from "./[screenId]/pairings";
import { ScreenSessionDelete, ScreenSessionPost } from "./[screenId]/session";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/:screenId", ScreenGet);
openapi.patch("/:screenId", ScreenPatch);
openapi.post("/:screenId/pairings", ScreenPairingPost);
openapi.post("/:screenId/session", ScreenSessionPost);
openapi.delete("/:screenId/session", ScreenSessionDelete);

export default openapi;
