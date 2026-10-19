/**
 * Public sponsor branding is generated from a canonical publication fixture.
 * Runtime sponsor pagination remains covered by the frontend island tests.
 * @covers sponsor.2.5
 */
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { publicSponsorDisplayGroupSchema } from "../../assets/shared/schemas/public-sponsors";
import { sponsorPublicationKey } from "../../assets/shared/sponsor-publication-query";
import { publishE2eSite } from "./helpers/site-publication";

const eventSponsorsPath = "/events/2026/pqc-conference-amsterdam-nl/sponsors/";

test("publishes accessible event sponsor branding without visitor API or JavaScript dependencies", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000); // Native extraction, followed by the synthetic static release.
  await page.goto(eventSponsorsPath);
  const nativePublication = await publishE2eSite(page, eventSponsorsPath);
  const selection = sponsorPublicationKey({ "event-slug": "pqc-conference-amsterdam-nl", level: "all" });
  expect(nativePublication.snapshot.sponsors).toHaveProperty(selection);
  const groups = [
    { weight: 8, tierName: "Leader", name: "First sponsor", id: "00000000-0000-4000-8000-000000000001" },
    { weight: 5, tierName: "Supporter", name: "Second sponsor", id: "00000000-0000-4000-8000-000000000002" },
  ].map(({ weight, tierName, name, id }) =>
    publicSponsorDisplayGroupSchema.parse({
      weight,
      tierName,
      sponsors: [
        {
          id,
          name,
          website: "https://example.com/",
          logoUrl: "/favicon.svg",
          tier: null,
          eventTier: tierName,
          effectiveTier: tierName,
          weight,
        },
      ],
    }),
  );
  const snapshot = sitePublicationSnapshotSchema.parse({
    ...nativePublication.snapshot,
    snapshotId: createHash("sha256")
      .update(JSON.stringify([nativePublication.snapshot.snapshotId, selection, groups]))
      .digest("hex"),
    sponsors: { ...nativePublication.snapshot.sponsors, [selection]: groups },
  });
  await publishE2eSite(page, eventSponsorsPath, snapshot);

  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const publicPage = await context.newPage();
    const visitorApiRequests: string[] = [];
    await publicPage.route("**/api/**", async (route) => {
      visitorApiRequests.push(new URL(route.request().url()).pathname);
      await route.abort();
    });
    const response = await publicPage.goto(new URL(eventSponsorsPath, page.url()).href);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-pkic-publication"]).toBe(`static; snapshot=${snapshot.snapshotId}`);
    await expect(
      publicPage.getByRole("heading", { name: "Sponsors — PQC Conference Amsterdam 2026", exact: true }),
    ).toBeVisible();
    for (const group of groups) {
      const sponsor = group.sponsors[0]!;
      const label = `${sponsor.name} is a ${group.tierName} sponsor for the PKI Consortium`;
      const image = publicPage.getByRole("img", { name: label, exact: true });
      await expect(image).toBeVisible();
      await expect(image).toHaveJSProperty("complete", true);
      expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      const tier = publicPage.locator(".sponsors-tier").filter({ has: image });
      await expect(tier.locator(".sponsor-level")).toHaveText(group.tierName);
      await expect(tier.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", sponsor.website!);
    }
    await expect(publicPage.getByRole("button", { name: "Load more sponsors", exact: true })).toHaveCount(0);
    expect(visitorApiRequests).toEqual([]);
  } finally {
    await context.close();
  }
});
