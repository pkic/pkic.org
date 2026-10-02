import { expect, it } from "vitest";
import {
  sitePublicationSnapshotSchema,
  sitePublishedEventFlowSchema,
} from "../../assets/shared/schemas/site-publication";
import { loadPublishedEventFlow } from "../../functions/_lib/services/site-event-flows";
import fixture from "../fixtures/site-publication.json";

it("renders only an explicitly published event at its canonical URL using the existing workflow template", async () => {
  const publication = sitePublicationSnapshotSchema.parse({
    ...fixture,
    eventFlows: [
      {
        eventName: "Synthetic community workshop",
        flow: "registration",
        route: "/events/2026/community-workshop/register/",
      },
    ],
  });
  const content = await loadPublishedEventFlow(
    "/events/2026/community-workshop/register/",
    publication,
    async (path) => {
      expect(path).toBe("/_event-flow-shells/registration/");
      return {
        route: path,
        title: "Event registration",
        html: "<form></form>",
        robots: "noindex",
        draft: false,
        hero: { title: "Event registration", tone: "default" },
      };
    },
  );
  expect(content).toMatchObject({
    route: "/events/2026/community-workshop/register/",
    title: "Event registration — Synthetic community workshop",
    robots: "noindex",
  });
  expect(
    await loadPublishedEventFlow("/events/2026/private-event/register/", publication, async () => {
      throw new Error("Private content must not be loaded");
    }),
  ).toBeNull();
});

it("rejects a mismatched workflow or noncanonical route before publication", () => {
  const page = { eventName: "Synthetic workshop", flow: "registration", route: "/events/2026/workshop/propose/" };
  expect(sitePublishedEventFlowSchema.safeParse(page).success).toBe(false);
  expect(
    sitePublishedEventFlowSchema.safeParse({ ...page, route: "https://example.test/events/workshop/register/" })
      .success,
  ).toBe(false);
});
