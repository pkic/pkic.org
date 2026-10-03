import { z } from "zod";
import {
  githubApplicationEvidenceSchema,
  githubApplicationEventSchema,
  githubApplicationIssueSchema,
} from "../../../../../assets/shared/schemas/membership-application-import";
import { AppError } from "../../../errors";
import { readBoundedStream } from "../../../utils/bounded-stream";

/** Fixed host/repository and bounded pages; neither credentials nor private evidence enter logs. */
export function githubApplicationSourceReader(token: string | undefined) {
  if (!token)
    throw new AppError(
      503,
      "APPLICATION_IMPORT_DISABLED",
      "Source access must be configured for the separately authorized production import",
    );
  async function get(path: string) {
    const response = await fetch(`https://api.github.com/repos/pkic/members/${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "PKIC membership application import",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new AppError(
        502,
        "APPLICATION_SOURCE_UNAVAILABLE",
        "GitHub source evidence could not be read; no application was imported",
      );
    const result = await readBoundedStream(response.body, 1_500_000, "Source evidence exceeds the import limit");
    if (!result.ok)
      throw new AppError(422, "APPLICATION_SOURCE_TOO_LARGE", "Review oversized source evidence before importing");
    return JSON.parse(new TextDecoder().decode(result.bytes));
  }
  async function events(number: number, kind: "comments" | "timeline") {
    const items: z.infer<typeof githubApplicationEventSchema>[] = [];
    let bytes = 0;
    for (let page = 1; page <= 20; page++) {
      const rows = z
        .array(githubApplicationEventSchema)
        .parse(await get(`issues/${number}/${kind}?per_page=100&page=${page}`));
      bytes += new TextEncoder().encode(JSON.stringify(rows)).length;
      if (bytes > 1_500_000)
        throw new AppError(422, "APPLICATION_SOURCE_TOO_LARGE", "Review oversized source evidence before importing");
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    throw new AppError(422, "APPLICATION_SOURCE_TOO_LARGE", "Review this source's evidence volume before importing");
  }
  return async (number: number) => {
    const label = z
      .object({ id: z.number().int(), name: z.literal("Membership application") })
      .parse(await get("labels/Membership%20application"));
    const before = githubApplicationIssueSchema.parse(await get(`issues/${number}`));
    const comments = await events(number, "comments");
    const timeline = await events(number, "timeline");
    const after = githubApplicationIssueSchema.parse(await get(`issues/${number}`));
    if (
      before.updated_at !== after.updated_at ||
      before.state !== after.state ||
      before.state_reason !== after.state_reason ||
      JSON.stringify(before.labels) !== JSON.stringify(after.labels)
    )
      throw new AppError(
        409,
        "IMPORT_SOURCE_CHANGED",
        "The source changed while reading its evidence; rerun reconciliation",
      );
    return githubApplicationEvidenceSchema.parse({
      repository: "pkic/members",
      labelId: label.id,
      issue: after,
      comments,
      timeline,
    });
  };
}
