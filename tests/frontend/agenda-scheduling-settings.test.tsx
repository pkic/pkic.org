// @vitest-environment jsdom
import { beginRecordEdit } from "./helpers/record-edit";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  SchedulingRules,
  AgendaSettings,
} from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSettings";
import { GroupEventScheduling } from "../../assets/ts/member-flows/portal/sections/management/GroupEventScheduling";
import { agendaSnapshotSchema, agendaSettingsSchema } from "../../assets/shared/schemas/event-agenda";

const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 3,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  shifts: [],
  assignments: [],
  roleMembers: [],
});
const host = document.createElement("div");
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

it("renders authorized Settings scheduling inline and keeps its real save contract on the same tab", async () => {
  const fetcher = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(init?.method === "POST" ? { ...snapshot, revision: 4, travelMinutes: 12 } : snapshot),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  document.body.append(host);
  await act(() => render(<GroupEventScheduling slug="synthetic" canEdit />, host));
  await settle();
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.querySelector("form")).toBeNull();
  await beginRecordEdit(host, "Scheduling rules actions");
  expect(host.querySelector('section[aria-label="Scheduling rules"] form')).not.toBeNull();
  await act(() => {
    const input = host.querySelector<HTMLInputElement>('[name="travelMinutes"]')!;
    input.value = "12";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(agendaSettingsSchema.parse(JSON.parse(String(writes[0]![1]?.body)))).toMatchObject({
    expectedRevision: 3,
    travelMinutes: 12,
  });
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.querySelector("form")).toBeNull();
});

it("shares the same scheduling fields in the optional agenda modal and denies the settings form without edit authority", async () => {
  document.body.append(host);
  await act(() =>
    render(<SchedulingRules snapshot={snapshot} timeStep={5} onTimeStepChange={() => {}} onSaved={() => {}} />, host),
  );
  expect(host.querySelector("form")).toBeNull();
  await beginRecordEdit(host, "Scheduling rules actions");
  const fields = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")].map(
    (input) => input.name,
  );
  await act(() =>
    render(
      <AgendaSettings
        snapshot={snapshot}
        timeStep={5}
        onTimeStepChange={() => {}}
        onSaved={() => {}}
        onClose={() => {}}
      />,
      host,
    ),
  );
  expect(host.querySelector("dialog[open]")).not.toBeNull();
  expect(
    [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")].map((input) => input.name),
  ).toEqual(fields);
  await act(() => render(<GroupEventScheduling slug="synthetic" canEdit={false} />, host));
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("not available to your current identity");
});
