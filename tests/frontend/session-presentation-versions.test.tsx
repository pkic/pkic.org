import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPresentationVersions } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/PresentationVersionsTab";
import {
  sessionPresentationVersionSchema,
  sessionPresentationVersionsSchema,
  sessionPresentationReviewRequestSchema,
  sessionPresentationVersionResponseSchema,
} from "../../assets/shared/schemas/session-presentation-versions";
import { runRowAction, rowActionControlNames } from "./helpers/row-actions";
import { presentationUploadRequest } from "../../assets/shared/presentation-upload";
const occurrenceId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const base = `/api/v1/events/direct-event/agenda/occurrences/${occurrenceId}/materials/presentations`;
const draft = sessionPresentationVersionSchema.parse({
  id: versionId,
  occurrenceId,
  versionNumber: 1,
  fileName: "direct-session.pdf",
  fileSize: 18,
  mimeType: "application/pdf",
  uploadedByUserId: null,
  uploadedAt: "2026-12-01T09:00:00.000Z",
  isCurrent: true,
  deletedAt: null,
  latestReview: null,
});
let host: HTMLDivElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(canManage: boolean, onChanged = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <SessionPresentationVersions
        eventSlug="direct-event"
        occurrenceId={occurrenceId}
        canManage={canManage}
        onChanged={onChanged}
      />,
      host,
    ),
  );
  await settle();
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((row) => row.textContent?.trim() === label)!;
}
describe("direct session presentation management", () => {
  it("uploads through the existing binary protocol and reviews an occurrence version without a proposal", async () => {
    let version: typeof draft | null = null;
    const changed = vi.fn();
    const file = new File(["%PDF-1.7 synthetic"], "direct-session.pdf", { type: "application/pdf" });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === base) {
        expect(init.body).toBe(file);
        const expected = presentationUploadRequest(file);
        for (const [key, value] of Object.entries(expected.headers))
          expect(new Headers(init.headers).get(key)).toBe(value);
        version = { ...draft, fileSize: file.size };
        return Response.json(sessionPresentationVersionResponseSchema.parse({ version }));
      }
      if (init?.method === "POST" && url === `${base}/${versionId}/reviews`) {
        expect(sessionPresentationReviewRequestSchema.parse(JSON.parse(String(init.body)))).toEqual({
          status: "approved",
          note: null,
        });
        version = {
          ...draft,
          latestReview: {
            id: "33333333-3333-4333-8333-333333333333",
            versionId,
            reviewedByUserId: "44444444-4444-4444-8444-444444444444",
            reviewedAt: "2026-12-01T09:15:00.000Z",
            status: "approved",
            note: null,
          },
        };
        return Response.json(sessionPresentationVersionResponseSchema.parse({ version }));
      }
      return Response.json(
        sessionPresentationVersionsSchema.parse({
          versions: version ? [version] : [],
          page: { limit: 25, offset: 0, total: version ? 1 : 0, hasMore: false },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await mount(true, changed);
    await act(() => button("Upload on behalf of speaker").click());
    expect(host.querySelector("table")).toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file] });
    await act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    await settle();
    expect(host.textContent).toContain("direct-session.pdf");
    expect(host.textContent).toContain("Not reviewed");
    await runRowAction(host, "Version 1, direct-session.pdf", "Review");
    expect(host.querySelector("table")).toBeNull();
    await act(() => button("Save review").click());
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    await settle();
    expect(host.querySelector("[data-presentation-review-status]")?.textContent).toContain("Approved");
    expect(host.querySelector<HTMLAnchorElement>("a[download]")?.getAttribute("href")).toBe(
      `${base}/${versionId}/content`,
    );
    expect(fetcher.mock.calls.every(([url]) => !url.includes("proposals"))).toBe(true);
  });
  it("keeps read-only downloads private and omits upload, review and delete controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          sessionPresentationVersionsSchema.parse({
            versions: [draft],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          }),
        ),
      ),
    );
    await mount(false);
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(button("Review")).toBeUndefined();
    expect(button("Delete")).toBeUndefined();
    expect(rowActionControlNames(host)).toEqual([]);
    expect(host.querySelector<HTMLAnchorElement>("a[download]")?.getAttribute("href")).toBe(
      `${base}/${versionId}/content`,
    );
  });
});
