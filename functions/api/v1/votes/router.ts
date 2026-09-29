import { Hono } from "hono";
import { fromHono } from "chanfana";
import { VotesGet } from "./index";
import { VotesFeedRssGet } from "./feed.rss";
import { VoteGet } from "./[slug]";
import { publicReadRoute } from "../../../_lib/cache/public-read";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", publicReadRoute(VotesGet));
openapi.get("/feed.rss", publicReadRoute(VotesFeedRssGet));
openapi.get("/:slug", publicReadRoute(VoteGet));

export default openapi;
