import { Hono } from "hono";
import { fromHono } from "chanfana";
import { VotesGet } from "./index";
import { VotesFeedRssGet } from "./feed.rss";
import { VotesSlugGet } from "./[slug]";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", VotesGet);
openapi.get("/feed.rss", VotesFeedRssGet);
openapi.get("/:slug", VotesSlugGet);

export default openapi;
