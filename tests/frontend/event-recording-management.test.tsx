// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  eventRecordingSourceRefreshSchema,
  eventRecordingAcquireSchema,
  eventRecordingAcquisitionSchema,
  eventRecordingSourceBindSchema,
  eventRecordingSourceSchema,
  type EventRecordingAcquire,
} from "../../assets/shared/schemas/event-recordings";
import {
  eventRecordingMeetingLinkSchema,
  eventRecordingMeetingSchema,
} from "../../assets/shared/schemas/event-recording-discovery";
import { EventRecordings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventRecordings";
import { RecordingSourceEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/RecordingSourceEditor";
import { RecordingSourceDetails } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/RecordingSourceDetails";
import { portalSession, authStatus } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { menuItemNamed } from "./helpers/row-actions";
import { controlFor } from "./helpers/labelled-control";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));

const sourceId = "10000000-0000-4000-8000-000000000001";
const meetingId = "10000000-0000-4000-8000-000000000002";
const recordingId = "10000000-0000-4000-8000-000000000003";
const providerMeetingId = "10000000-0000-4000-8000-000000000004";
const acquisitionId = "10000000-0000-4000-8000-000000000005";
const now = "2026-10-07T10:00:00.000Z";
const source = eventRecordingSourceSchema.parse({
  id: sourceId,
  eventId: sourceId,
  meetingLinkId: meetingId,
  nativeOccurrenceId: null,
  provider: "realtimekit",
  providerMeetingId,
  recordingId,
  sessionId: recordingId,
  status: "UPLOADED",
  invokedAt: now,
  startedAt: now,
  stoppedAt: now,
  fileBytes: 100,
  metadataRevision: 2,
  observedAt: now,
  disabledAt: null,
});
const meeting = eventRecordingMeetingSchema.parse({
  id: meetingId,
  eventId: sourceId,
  nativeOccurrenceId: null,
  provider: "realtimekit",
  providerMeetingId,
  title: "Annual meeting",
  linkedAt: now,
});
const hosts: HTMLElement[] = [];
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function mount(node: Parameters<typeof render>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  await act(async () => {
    render(node, host);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`Missing action ${label}`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await act(async () => render(null, host));
    host.remove();
  }
  portalSession.value = null;
  authStatus.value = "anonymous";
  navigate.mockClear();
  vi.unstubAllGlobals();
});

it("reloads canonical source and acquisition history, retries one durable operation after refusal and refreshes its receipt", async () => {
  const captured: EventRecordingAcquire[] = [];
  const reads: string[] = [];
  const receipt = (operationId: string, status: "queued" | "failed") =>
    eventRecordingAcquisitionSchema.parse({
      id: acquisitionId,
      eventId: sourceId,
      sourceId,
      operationId,
      expectedMetadataRevision: 2,
      status,
      attempts: 1,
      nextAttemptAt: now,
      failure: status === "failed" ? "download_unavailable" : null,
      providerStatus: null,
      versionId: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://example.test");
      if (init?.method === "POST") {
        const body = eventRecordingAcquireSchema.parse(JSON.parse(String(init.body)));
        captured.push(body);
        return captured.length === 1
          ? json({ error: { code: "RECORDING_OWNERSHIP_CHANGED", message: "Recording request refused." } }, 409)
          : json(receipt(body.operationId, "queued"));
      }
      reads.push(url.pathname);
      if (url.pathname.endsWith(`/acquisitions/${acquisitionId}`))
        return json(receipt(captured[0]!.operationId, "failed"));
      if (url.pathname.endsWith("/acquisitions"))
        return json({ acquisitions: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      return json(source);
    }),
  );
  const host = await mount(
    <EventRecordings slug="synthetic" basePath="/events/synthetic/settings/recordings" sourceId={sourceId} />,
  );
  await settle();
  expect(reads.some((path) => path.endsWith(`/sources/${sourceId}`))).toBe(true);
  expect(reads.some((path) => path.endsWith("/acquisitions"))).toBe(true);
  await click(host, "Acquire recording");
  expect(host.textContent).toContain("Recording request refused.");
  await click(host, "Acquire recording");
  expect(captured).toHaveLength(2);
  expect(captured[1]).toEqual(captured[0]);
  expect(host.textContent).toContain("queued");
  await click(host, "Refresh status");
  expect(host.textContent).toContain("download unavailable");
  await click(host, "Acquire again");
  await click(host, "Acquire recording");
  expect(captured).toHaveLength(3);
  expect(captured[2]!.operationId).not.toBe(captured[0]!.operationId);
  expect(host.querySelector('input[name="providerMeetingId"],input[name="sourceId"]')).toBeNull();
  expect(host.textContent).not.toContain("providerMeetingId");
  expect(host.innerHTML).not.toContain("r2_key");
});

it("links a chosen meeting then binds an exact discovered recording with its hidden provider page", async () => {
  const linked: ReturnType<typeof eventRecordingMeetingLinkSchema.parse>[] = [];
  const bound: ReturnType<typeof eventRecordingSourceBindSchema.parse>[] = [];
  const saved = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://example.test");
      if (init?.method === "POST") {
        if (url.pathname.endsWith("/meetings")) {
          linked.push(eventRecordingMeetingLinkSchema.parse(JSON.parse(String(init.body))));
          return json(meeting);
        }
        bound.push(eventRecordingSourceBindSchema.parse(JSON.parse(String(init.body))));
        return json(source);
      }
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      const page = { limit, offset, total: 1, hasMore: false };
      if (url.pathname.endsWith("/meetings/discovery"))
        return json({
          meetings: [{ providerMeetingId, title: "Annual meeting", status: "ACTIVE", createdAt: now, updatedAt: now }],
          page,
        });
      if (url.pathname.endsWith("/meetings")) return json({ meetings: [], page: { ...page, total: 0 } });
      return json({
        meeting,
        recordings: [
          {
            recordingId,
            sessionId: recordingId,
            status: "UPLOADED",
            invokedAt: now,
            startedAt: now,
            stoppedAt: now,
            fileBytes: 100,
          },
        ],
        page,
      });
    }),
  );
  const host = await mount(
    <RecordingSourceEditor slug="synthetic" canLinkProviderMeetings onSaved={saved} onClose={() => {}} />,
  );
  await act(async () => controlFor<HTMLInputElement>(host, "Another provider meeting").click());
  await settle();
  const option = [...host.querySelectorAll('[role="option"]')].find((item) => item.textContent === "Annual meeting")!;
  await act(async () => {
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await click(host, "Link selected meeting to this event");
  expect(linked).toEqual([{ providerMeetingId }]);
  await act(async () => controlFor<HTMLButtonElement>(host, "Recording").click());
  await settle();
  const recording = [...host.querySelectorAll('[role="option"]')].find((item) =>
    item.textContent?.includes("uploaded"),
  )!;
  await act(async () => {
    recording.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await click(host, "Add recording");
  expect(bound).toEqual([{ meetingLinkId: meetingId, recordingId, discoveryPage: 0 }]);
  expect(saved).toHaveBeenCalledWith(source);
  expect(host.textContent).not.toContain(recordingId);
  expect(host.querySelector('[name="discoveryPage"]')).toBeNull();
});

it("shows why acquisition is unavailable while the provider is still uploading", async () => {
  const writes = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes();
        return json({});
      }
      const url = new URL(String(input), "https://example.test");
      return url.pathname.endsWith("/acquisitions")
        ? json({ acquisitions: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })
        : json(eventRecordingSourceSchema.parse({ ...source, status: "UPLOADING", fileBytes: 0 }));
    }),
  );
  const host = await mount(
    <EventRecordings slug="synthetic" basePath="/events/synthetic/settings/recordings" sourceId={sourceId} />,
  );
  await settle();
  expect(host.textContent).toContain("Wait for the provider to finish uploading a non-empty recording");
  const acquire = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Acquire recording",
  )!;
  expect(acquire.disabled).toBe(true);
  await act(async () => acquire.click());
  expect(writes).not.toHaveBeenCalled();
});

it("keeps scoped managers on linked meetings without calling app-wide provider discovery", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://example.test");
      requests.push(url.pathname);
      return json({ meetings: [meeting], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
    }),
  );
  const host = await mount(<RecordingSourceEditor slug="synthetic" onSaved={() => {}} onClose={() => {}} />);
  expect(
    [...host.querySelectorAll("label")].some((label) => label.textContent?.includes("Another provider meeting")),
  ).toBe(false);
  expect(controlFor(host, "Linked meeting")).toBeTruthy();
  expect(requests.every((path) => !path.endsWith("/meetings/discovery"))).toBe(true);
});

function authorizeMetadataRefresh() {
  const session = portalSessionFixture({
    staff: true,
    administrator: false,
    grants: [{ permission: "events:manage", contextType: "event", contextId: source.eventId }],
  });
  portalSession.value = session;
  authStatus.value = "authenticated";
  return session;
}
async function metadataAction(host: HTMLElement) {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Recording actions"]');
  expect(trigger).not.toBeNull();
  if (trigger!.getAttribute("aria-expanded") !== "true") await act(async () => trigger!.click());
  const action = menuItemNamed(host, "Refresh metadata");
  if (!action) throw new Error("Refresh metadata is missing from Recording actions.");
  return action;
}

async function runMetadataRefresh(host: HTMLElement) {
  const action = await metadataAction(host);
  await act(async () => action.click());
}

it("refreshes an ongoing recording explicitly and uses returned metadata for a later acquisition", async () => {
  authorizeMetadataRefresh();
  const refreshes: ReturnType<typeof eventRecordingSourceRefreshSchema.parse>[] = [];
  const acquisitions: EventRecordingAcquire[] = [];
  const reload = vi.fn(async () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname.endsWith("/refresh")) {
        refreshes.push(eventRecordingSourceRefreshSchema.parse(JSON.parse(String(init?.body))));
        expect(init?.method).toBe("POST");
        return json(eventRecordingSourceSchema.parse({ ...source, metadataRevision: 3 }));
      }
      if (init?.method === "POST") {
        const request = eventRecordingAcquireSchema.parse(JSON.parse(String(init.body)));
        acquisitions.push(request);
        return json(
          eventRecordingAcquisitionSchema.parse({
            id: acquisitionId,
            eventId: source.eventId,
            sourceId: source.id,
            operationId: request.operationId,
            expectedMetadataRevision: request.expectedMetadataRevision,
            status: "queued",
            attempts: 0,
            nextAttemptAt: now,
            failure: null,
            providerStatus: null,
            versionId: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
      return json({ acquisitions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
    }),
  );
  const host = await mount(
    <RecordingSourceDetails
      slug="synthetic"
      source={eventRecordingSourceSchema.parse({ ...source, status: "RECORDING", fileBytes: 0, stoppedAt: null })}
      onClose={() => {}}
      onRefresh={reload}
    />,
  );
  expect(refreshes).toHaveLength(0);
  expect(
    [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Acquire recording")?.disabled,
  ).toBe(true);
  await runMetadataRefresh(host);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(refreshes).toEqual([{ expectedMetadataRevision: 2 }]);
  expect(acquisitions).toHaveLength(0);
  expect(host.textContent).toContain("Uploaded");
  await click(host, "Acquire recording");
  expect(acquisitions).toHaveLength(1);
  expect(acquisitions[0]?.expectedMetadataRevision).toBe(3);
});

it("keeps a metadata conflict visible while rereading and never silently retries or acquires", async () => {
  authorizeMetadataRefresh();
  let release = () => {};
  const read = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reload = vi.fn(() => read);
  const writes: ReturnType<typeof eventRecordingSourceRefreshSchema.parse>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(eventRecordingSourceRefreshSchema.parse(JSON.parse(String(init.body))));
        return json(
          {
            error: {
              code: "RECORDING_SOURCE_CHANGED",
              message: "Recording metadata changed. Reload before trying again.",
            },
          },
          409,
        );
      }
      return json({ acquisitions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
    }),
  );
  const host = await mount(
    <RecordingSourceDetails slug="synthetic" source={source} onClose={() => {}} onRefresh={reload} />,
  );
  await runMetadataRefresh(host);
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Recording metadata changed.");
  expect(writes).toEqual([{ expectedMetadataRevision: 2 }]);
  expect(
    [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Acquire recording")?.disabled,
  ).toBe(true);
  await act(async () => release());
  expect(writes).toHaveLength(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Recording metadata changed.");
});

it("retains the expected revision after a metadata no-op", async () => {
  authorizeMetadataRefresh();
  const writes: ReturnType<typeof eventRecordingSourceRefreshSchema.parse>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(eventRecordingSourceRefreshSchema.parse(JSON.parse(String(init.body))));
        return json(source);
      }
      return json({ acquisitions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
    }),
  );
  const host = await mount(
    <RecordingSourceDetails slug="synthetic" source={source} onClose={() => {}} onRefresh={async () => {}} />,
  );
  await runMetadataRefresh(host);
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  const nextRefresh = await metadataAction(host);
  await vi.waitFor(() => expect(nextRefresh.disabled).toBe(false));
  await act(async () => nextRefresh.click());
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toEqual([{ expectedMetadataRevision: 2 }, { expectedMetadataRevision: 2 }]);
  expect(host.textContent).toContain("Uploaded");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("offers no metadata write for a disabled recording or an expired session", async () => {
  const session = authorizeMetadataRefresh();
  const writes = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") writes();
      return json({ acquisitions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
    }),
  );
  const host = await mount(
    <RecordingSourceDetails
      slug="synthetic"
      source={eventRecordingSourceSchema.parse({ ...source, disabledAt: now })}
      onClose={() => {}}
      onRefresh={async () => {}}
    />,
  );
  const disabled = await metadataAction(host);
  expect(disabled.disabled).toBe(true);
  await act(async () => disabled.click());
  expect(writes).not.toHaveBeenCalled();
  await act(async () => {
    portalSession.value = { ...session, expiresAt: "2000-01-01T00:00:00.000Z" };
    render(
      <RecordingSourceDetails slug="synthetic" source={source} onClose={() => {}} onRefresh={async () => {}} />,
      host,
    );
  });
  const expired = await metadataAction(host);
  expect(expired.disabled).toBe(true);
  await act(async () => expired.click());
  expect(writes).not.toHaveBeenCalled();
});

it("ignores a metadata response after the authenticated session changes", async () => {
  const session = authorizeMetadataRefresh();
  const pending: { finish?: (response: Response) => void; signal?: AbortSignal | null } = {};
  const response = new Promise<Response>((resolve) => {
    pending.finish = resolve;
  });
  const reload = vi.fn(async () => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        eventRecordingSourceRefreshSchema.parse(JSON.parse(String(init.body)));
        pending.signal = init.signal;
        return response;
      }
      return json({ acquisitions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
    }),
  );
  const host = await mount(
    <RecordingSourceDetails
      slug="synthetic"
      source={eventRecordingSourceSchema.parse({ ...source, status: "UPLOADING", fileBytes: 0 })}
      onClose={() => {}}
      onRefresh={reload}
    />,
  );
  await runMetadataRefresh(host);
  await vi.waitFor(() => expect(pending.signal).toBeDefined());
  await act(async () => {
    portalSession.value = { ...session, sessionId: "10000000-0000-4000-8000-000000000099" };
  });
  await vi.waitFor(() => expect(pending.signal?.aborted).toBe(true));
  await act(async () => pending.finish!(json(eventRecordingSourceSchema.parse({ ...source, metadataRevision: 3 }))));
  expect(reload).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Uploading");
  expect(host.textContent).not.toContain("Uploaded");
});
