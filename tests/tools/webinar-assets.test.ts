import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { webinarSponsors } from "../../scripts/lib/webinar-assets.mjs";

it("publishes authored webinar logos without depending on blog bylines or a member directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pkic-webinar-assets-"));
  try {
    await mkdir(join(root, "content/events"), { recursive: true });
    await mkdir(join(root, "assets/images/members/example"), { recursive: true });
    await writeFile(join(root, "assets/images/members/example/example.svg"), "<svg/>");
    await writeFile(
      join(root, "content/events/webinar.md"),
      "---\nlayout: webinar\nparams:\n  sponsor: example\n  sponsorName: Example Organization\n---\nWebinar content\n",
    );
    expect(webinarSponsors(root)).toEqual({
      "events/webinar": { name: "Example Organization", logoSrc: "/images/members/example/example.svg" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
