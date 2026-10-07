import type { ApiDataTableProps } from "../../assets/ts/components/ApiDataTable";
import {
  agendaContentSchema,
  agendaContentsResponseSchema,
  agendaContentCreateSchema,
  agendaContentPatchSchema,
} from "../../assets/shared/schemas/event-agenda-content";
import type { z } from "zod";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  onSaved: vi.fn(),
  row: {
    id: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    title: "Organizer title",
    description: "Local abstract",
    kind: "session",
    speakerUserIds: [],
    sourceKey: "proposal:source",
    review: {
      reason: "source_changed",
      incoming: {
        title: "Updated source title",
        description: "Updated source abstract",
        kind: "session",
        speakerUserIds: [],
      },
    },
    occurrenceCount: 2,
  } as z.input<typeof agendaContentSchema>,
}));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  getJson: mocks.get,
  postJson: mocks.post,
  patchJson: mocks.patch,
}));
vi.mock("../../assets/ts/components/ApiDataTable", () => ({
  ApiDataTable: (
    props: ApiDataTableProps<z.infer<typeof agendaContentSchema>, z.infer<typeof agendaContentsResponseSchema>>,
  ) => (
    <div data-testid="content-list">
      {props.createAction && "onSelect" in props.createAction && (
        <button onClick={props.createAction.onSelect}>{props.createAction.label}</button>
      )}
      {props.toolbar?.({ reload: async () => {}, resetPage: () => {} }, {})}
      {props.columns.map((column) => column.cell(agendaContentSchema.parse(mocks.row), 0))}
    </div>
  ),
}));
vi.mock("../../assets/ts/components/UserPicker", () => ({ UserPicker: () => null }));
vi.mock("../../assets/ts/components/ServerSearchSelect", () => ({ ServerSearchSelect: () => null }));
import { historicalMappingFixture } from "./helpers/historical-mapping-fixture";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { ContentLibrary } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/ContentLibrary";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 3,
  publishedRevision: 1,
  rooms: [],
  occurrences: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLDivElement;
function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
}
beforeEach(async () => {
  delete mocks.row.review!.incomingHistoricalMetadata;
  host = document.createElement("div");
  document.body.append(host);
  mocks.get.mockResolvedValue({ ...snapshot, revision: 4 });
  mocks.post.mockResolvedValue(mocks.row);
  mocks.patch.mockResolvedValue(mocks.row);
  await act(async () => {
    render(<ContentLibrary snapshot={snapshot} canEdit onSaved={mocks.onSaved} />, host);
  });
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.clearAllMocks();
});
it("creates substantive content without sending an invented occurrence or attendance data", async () => {
  expect(host.querySelector("form")).toBeNull();
  await act(async () => button("New session content").click());
  expect(host.querySelector('[data-testid="content-list"]')).toBeNull();
  const title = host.querySelector<HTMLInputElement>('[name="content.title"]')!;
  await act(async () => {
    title.value = "New workshop";
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(mocks.post).toHaveBeenCalledWith(
    "/api/v1/events/synthetic/agenda/contents",
    {
      expectedRevision: 3,
      content: {
        title: "New workshop",
        track: null,
        description: "",
        kind: "session",
        speakerUserIds: [],
        speakerRoles: {},
      },
    },
    expect.anything(),
  );
  const body = agendaContentCreateSchema.parse(mocks.post.mock.calls[0]![1]);
  expect(body.content.title).toBe("New workshop");
  expect(mocks.onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 4, publishedRevision: 1 }));
});
it("uses a distinct placement command for repeats and independent copies", async () => {
  await act(async () => button("⋯").click());
  await act(async () => button("Add repeat").click());
  expect(mocks.post).toHaveBeenCalledWith(
    `/api/v1/events/synthetic/agenda/contents/${mocks.row.id}/placements`,
    { expectedRevision: 3, copyAsNew: false },
    expect.anything(),
  );
  await act(async () => {});
  await act(async () => button("⋯").click());
  await act(async () => button("Copy as new").click());
  expect(mocks.post).toHaveBeenLastCalledWith(
    `/api/v1/events/synthetic/agenda/contents/${mocks.row.id}/placements`,
    { expectedRevision: 3, copyAsNew: true },
    expect.anything(),
  );
});
it("keeps local source edits until the organizer deliberately adopts the incoming revision", async () => {
  await act(async () => button("⋯").click());
  await act(async () => button("Edit content").click());
  expect(host.querySelector<HTMLInputElement>('[name="content.title"]')!.value).toBe("Organizer title");
  await act(async () => button("Use incoming source content").click());
  expect(host.querySelector<HTMLInputElement>('[name="content.title"]')!.value).toBe("Updated source title");
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(agendaContentPatchSchema.parse(mocks.patch.mock.calls[0]![1]).resolveSourceReview).toBe(true);
  expect(mocks.patch).toHaveBeenCalledWith(
    `/api/v1/events/synthetic/agenda/contents/${mocks.row.id}`,
    expect.objectContaining({
      resolveSourceReview: true,
      content: expect.objectContaining({ title: "Updated source title" }),
    }),
    expect.anything(),
  );
});

it("cancels dedicated edits and copying without leaving forms in the library", async () => {
  expect(host.querySelector("form")).toBeNull();
  await act(async () => button("New session content").click());
  await act(async () => button("Back to reusable sessions").click());
  expect(host.querySelector("form")).toBeNull();
  await act(async () => button("Reuse from another event").click());
  expect(host.querySelector('[data-testid="content-list"]')).toBeNull();
  expect(host.querySelector("form")).not.toBeNull();
  await act(async () => button("Back to reusable sessions").click());
  expect(host.querySelector("form")).toBeNull();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
});

it("requires explicit historical mapping approval after adopting incoming source content", async () => {
  mocks.row.review!.incomingHistoricalMetadata = [historicalMappingFixture()];
  await act(async () => {
    render(null, host);
  });
  await act(async () => render(<ContentLibrary snapshot={snapshot} canEdit onSaved={mocks.onSaved} />, host));
  await act(async () => button("⋯").click());
  await act(async () => button("Edit content").click());
  expect(host.textContent).toContain("Verified historical mapping changes");
  await act(async () => button("Use incoming source content").click());
  const acknowledgment = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(acknowledgment.checked).toBe(false);
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(agendaContentPatchSchema.parse(mocks.patch.mock.calls[0]![1]).resolveSourceReview).toBe(false);
  await act(async () => {
    acknowledgment.checked = true;
    acknowledgment.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const accepted = agendaContentPatchSchema.parse(mocks.patch.mock.calls[1]![1]);
  expect(accepted.resolveSourceReview).toBe(true);
  expect("incomingHistoricalMetadata" in accepted).toBe(false);
});

it("keeps incomplete historical source/title mapping approval disabled", async () => {
  const entry = historicalMappingFixture();
  entry.reviewIssues = ["title_unresolved", "credit_unresolved"];
  mocks.row.review!.incomingHistoricalMetadata = [entry];
  await act(async () => {
    render(null, host);
  });
  await act(async () => render(<ContentLibrary snapshot={snapshot} canEdit onSaved={mocks.onSaved} />, host));
  await act(async () => button("⋯").click());
  await act(async () => button("Edit content").click());
  await act(async () => button("Use incoming source content").click());
  const acknowledgment = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(acknowledgment.disabled).toBe(true);
  expect(acknowledgment.checked).toBe(false);
  expect(host.textContent).toContain("Verify the missing historical title");
  expect(host.textContent).toContain("Verify each missing historical credit");
});

it("keeps the dedicated historical review visible when atomic acceptance refuses a stale or mismatched roster", async () => {
  mocks.row.review!.incomingHistoricalMetadata = [historicalMappingFixture()];
  await act(async () => {
    render(null, host);
  });
  await act(async () => render(<ContentLibrary snapshot={snapshot} canEdit onSaved={mocks.onSaved} />, host));
  mocks.patch.mockRejectedValueOnce(
    new ApiClientError(
      {
        error: {
          code: "SOURCE_REVIEW_CONFLICT",
          message: "Source review roster changed; review the current mappings.",
        },
      },
      409,
    ),
  );
  await act(async () => button("⋯").click());
  await act(async () => button("Edit content").click());
  const acknowledgment = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => {
    acknowledgment.checked = true;
    acknowledgment.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(agendaContentPatchSchema.parse(mocks.patch.mock.calls[0]![1]).resolveSourceReview).toBe(true);
  expect(host.textContent).toContain("Source review roster changed");
  expect(host.textContent).toContain("Verified historical mapping changes");
  expect(host.querySelector('[data-testid="content-list"]')).toBeNull();
});

it("saves an optional program track through the shared content contract", async () => {
  await act(async () => button("New session content").click());
  for (const [name, value] of [
    ["content.title", "New workshop"],
    ["content.track", "  Cryptography  "],
  ]) {
    const field = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    await act(async () => {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(agendaContentCreateSchema.parse(mocks.post.mock.calls[0]![1]).content.track).toBe("Cryptography");
});
