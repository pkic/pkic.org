// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventDetailQuerySchema, eventDetailSchema } from "../../assets/shared/schemas/event-management";
import { GroupEventSettingsSection } from "../../assets/ts/member-flows/portal/sections/management/GroupEventSettingsSection";
import { GroupEventSessionTypes } from "../../assets/ts/member-flows/portal/sections/management/GroupEventSessionTypes";
import { cleanup, json, mount, responseEvent, settle } from "./helpers/event-management";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
afterEach(cleanup);
const event = eventDetailSchema.parse({
  ...responseEvent,
  capabilities: ["read"],
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  sessionTypes: [],
  seriesId: null,
  settings: {},
});
describe("selected-group settings reads", () => {
  it.each(["general", "session-types"])("loads %s with the group context used for saving", async (section) => {
    const fetcher = vi.fn(async (_url: string) => json({ event }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      if (section === "general")
        mount(
          <GroupEventSettingsSection
            slug={event.slug}
            section="general"
            groupSettings={{ groupId: responseEvent.ownerGroupId, eventId: event.id, canEdit: true }}
          />,
        );
      else
        mount(
          <GroupEventSessionTypes slug={event.slug} groupId={responseEvent.ownerGroupId} eventId={event.id} canEdit />,
        );
    });
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const address = new URL(fetcher.mock.calls[0][0], "https://app.test");
    expect(address.pathname).toBe(`/api/v1/events/${event.slug}`);
    expect(eventDetailQuerySchema.parse(Object.fromEntries(address.searchParams)).groupId).toBe(
      responseEvent.ownerGroupId,
    );
  });
});
