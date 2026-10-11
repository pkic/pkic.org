import { z } from "zod";
import { runCommand } from "./process.mjs";
import {
  githubApplicationEvidenceSchema,
  githubApplicationEventSchema,
  githubApplicationIssueSchema,
  githubApplicationTimelineEventSchema,
} from "./source-contracts.mjs";
import { digest } from "./manifest.mjs";

/** Source access stays in the operator's authenticated gh session, never in deployed Worker configuration. */
export async function readGithubSource(number, signal, command = runCommand) {
  const get = async (path) =>
    JSON.parse(await command("gh", ["api", `repos/pkic/members/${path}`, "--method", "GET"], signal));
  const events = async (kind, schema) => {
    const items = [];
    for (let page = 1; page <= 20; page++) {
      const rows = z.array(schema).parse(await get(`issues/${number}/${kind}?per_page=100&page=${page}`));
      items.push(...rows);
      if (Buffer.byteLength(JSON.stringify(items)) > 1_500_000) throw new Error("Source evidence too large");
      if (rows.length < 100) return items;
    }
    throw new Error("Source evidence page limit reached");
  };
  const label = z
    .object({ id: z.number().int().positive(), name: z.literal("Membership application") })
    .parse(await get("labels/Membership%20application"));
  const before = githubApplicationIssueSchema.parse(await get(`issues/${number}`));
  const comments = await events("comments", githubApplicationEventSchema);
  const timeline = await events("timeline", githubApplicationTimelineEventSchema);
  const after = githubApplicationIssueSchema.parse(await get(`issues/${number}`));
  if (digest(before) !== digest(after)) throw new Error("Source changed while reading");
  return githubApplicationEvidenceSchema.parse({
    repository: "pkic/members",
    labelId: label.id,
    issue: after,
    comments,
    timeline,
  });
}
