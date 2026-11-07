// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailQuerySchema, eventDetailSchema } from "../../assets/shared/schemas/event-management";
import { groupEventSettingsUpdateSchema } from "../../assets/shared/schemas/group-events";
import { GroupEventSettingsSection } from "../../assets/ts/member-flows/portal/sections/management/GroupEventSettingsSection";
import { cleanup, GROUP_ID, json, mount, responseEvent, settle } from "./helpers/event-management";
import { controlFor, typeInto } from "./helpers/labeled-control";
import { beginRecordEdit } from "./helpers/record-edit";

afterEach(cleanup);

it("saves a website event's CFP deadline through its group contract and permissions", async () => {
  const event = eventDetailSchema.parse({
    ...responseEvent,
    registrationPath: null,
    sourceMode: "integration",
    userRetentionDays: null,
    venue: null,
    virtualUrl: null,
    heroImageUrl: null,
    sessionTypes: null,
    settings: {},
    capabilities: ["read"],
  });
  const updatedAt = "2026-11-04T12:00:00.000Z";
  const formId = "20000000-0000-4000-8000-000000000001";
  const settingsPath = `/api/v1/groups/${GROUP_ID}/events/${event.id}/settings`;
  const saved: unknown[] = [];
  const detailReads: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (path === settingsPath && init?.method === "PATCH") {
        if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
        const settings = groupEventSettingsUpdateSchema.parse(JSON.parse(init.body));
        saved.push(settings.proposalSubmissionWindow);
        return json({ event: { ...responseEvent, sourceMode: "integration", updatedAt } });
      }
      const url = new URL(path, "https://app.test");
      if (url.pathname === `/api/v1/events/${event.slug}`) {
        const groupId = eventDetailQuerySchema.parse(Object.fromEntries(url.searchParams)).groupId;
        detailReads.push(groupId ?? "");
        if (groupId !== GROUP_ID)
          return new Response(JSON.stringify({ error: "Event not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        return json({ event: { ...event, updatedAt: saved.length ? updatedAt : event.updatedAt } });
      }
      if (path === `/api/v1/events/${event.slug}/forms/placements/proposal_submission`) {
        return json({
          event,
          registrationPolicy: "no_registration",
          purpose: "proposal_submission",
          form: {
            id: formId,
            key: "group-proposals",
            title: "Working group proposals",
            description: null,
            fields: [],
            placement: {
              id: "30000000-0000-4000-8000-000000000001",
              formId,
              ownerGroupId: GROUP_ID,
              contextType: "event",
              contextRef: event.id,
              audience: "speaker",
              active: true,
              opensAt: null,
              closesAt: saved.length ? "2026-10-31T22:59:00.000Z" : null,
              createdAt: event.updatedAt,
              updatedAt: event.updatedAt,
            },
          },
          requiredTerms: [],
          allowedSessionTypes: [],
          eventDays: [],
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }),
  );
  const onUpdated = vi.fn<() => void>();
  const container = mount(
    <GroupEventSettingsSection
      slug={event.slug}
      groupSettings={{ groupId: GROUP_ID, eventId: event.id, canEdit: true }}
      onUpdated={onUpdated}
    />,
  );
  await settle();
  await beginRecordEdit(container, "Call for proposals actions", "Edit CFP settings");
  await typeInto(controlFor(container, "Closes"), "2026-10-31T23:59");
  await act(() => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(saved).toEqual([{ opensAt: null, closesAt: "2026-10-31T22:59:00.000Z" }]);
  expect(onUpdated).toHaveBeenCalledOnce();
  expect(detailReads.length).toBeGreaterThanOrEqual(2);
  expect(detailReads.every((groupId) => groupId === GROUP_ID)).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await beginRecordEdit(container, "Call for proposals actions", "Edit CFP settings");
  expect((controlFor(container, "Closes") as HTMLInputElement).value).toBe("2026-10-31T23:59");
});
