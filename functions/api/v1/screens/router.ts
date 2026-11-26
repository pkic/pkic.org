import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ScreenDelete, ScreenGet, ScreenPatch } from "./[screenId]";
import { ScreenDevicePut } from "./[screenId]/device";
import { ScreenPairingPost } from "./[screenId]/pairings";
import { ScreenSessionPost } from "./[screenId]/session";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/:screenId", ScreenGet);
openapi.patch("/:screenId", ScreenPatch);
openapi.delete("/:screenId", ScreenDelete);
openapi.put("/:screenId/device", ScreenDevicePut);
openapi.post("/:screenId/pairings", ScreenPairingPost);
openapi.post("/:screenId/session", ScreenSessionPost);

export default openapi;
