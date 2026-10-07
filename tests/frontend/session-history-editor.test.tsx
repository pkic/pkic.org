import { MaterialFields } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionArchiveFields";
import {
  sessionHistoryMetadataSchema,
  sessionMaterialSchema,
  sessionMaterialVersionsSchema,
} from "../../assets/shared/schemas/event-session-history";
// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SessionHistoryEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionHistoryEditor";
import { sessionHistoryCorrectionSchema } from "../../assets/shared/schemas/event-session-history";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { chooseOption, controlFor, optionValues, submitForm, typeInto } from "./helpers/labelled-control";
import { legacyAgendaDownloadsSchema } from "../../assets/shared/schemas/event-agenda-legacy-fragments";
import { menuItemNamed } from "./helpers/row-actions";
import type { z } from "zod";
const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => api);
/** Match getJson's canonical transport parsing, including additive response defaults. */
function mockGetJson(payload: unknown | ((path: string) => Promise<unknown>)) {
  api.getJson.mockImplementation(async (path: string, schema: z.ZodType) =>
    schema.parse(typeof payload === "function" ? await payload(path) : payload),
  );
}
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  vi.clearAllMocks();
});
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: 6,
  rooms: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [
    {
      id: "session",
      title: "Trustworthy systems",
      description: "Substantive approved session describing cryptographic operations.",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
      speakers: [{ userId: "speaker", displayName: "Example speaker" }],
    },
  ],
});
describe("session archive correction", () => {
  it.each(["recording", "transcript", "captions"] as const)(
    "clears uploaded PDF bindings when changing to %s while preserving the supplied external URL",
    async (kind) => {
      mockGetJson({ versions: [], page: { limit: 200, offset: 0, total: 0, hasMore: false } });
      const externalUrl = `https://media.example.test/${kind}`;
      const initial = sessionMaterialSchema.parse({
        id: "release",
        kind: "presentation",
        title: "Material",
        url: externalUrl,
        presentationSource: "session",
        presentationVersionId: "uploaded-version",
        version: 1,
        legacyDownloadUrl: "/events/event/slides.pdf",
        rightsConfirmed: false,
        consentConfirmed: false,
        validated: false,
        status: "draft",
        approvedAt: null,
      });
      const changed = vi.fn();
      function ControlledMaterials() {
        const [materials, setMaterials] = useState([initial]);
        return (
          <MaterialFields
            slug="event"
            occurrenceId="session"
            materials={materials}
            onChange={(next) => {
              changed(next);
              setMaterials(next);
            }}
          />
        );
      }
      await act(() => render(<ControlledMaterials />, host));
      expect(controlFor(host, "Uploaded presentation version")).toBeDefined();
      await chooseOption(controlFor(host, "Material type"), kind);
      const result = sessionMaterialSchema.parse(changed.mock.calls[0]![0][0]);
      expect(result).toMatchObject({
        kind,
        url: externalUrl,
        presentationVersionId: null,
        presentationSource: "proposal",
        legacyDownloadUrl: null,
        status: "draft",
        approvedAt: null,
      });
      expect(controlFor<HTMLInputElement>(host, "Public delivery URL").value).toBe(externalUrl);
      expect([...host.querySelectorAll("label")].map((label) => label.textContent)).not.toContain(
        "Uploaded presentation version",
      );
      expect(host.textContent).not.toContain("The public delivery URL is generated from this uploaded version.");
      expect(initial.presentationVersionId).toBe("uploaded-version");
      expect(initial.kind).toBe("presentation");
    },
  );

  it("keeps all archive actions in the shared menu and closes through its existing callback", async () => {
    mockGetJson({
      identities: [],
      versions: [],
      page: { limit: 200, offset: 0, total: 0, hasMore: false },
    });
    const close = vi.fn();
    await act(() =>
      render(
        <SessionHistoryEditor
          snapshot={snapshot}
          occurrence={snapshot.occurrences[0]!}
          onSaved={() => {}}
          onClose={close}
        />,
        host,
      ),
    );
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Session archive actions"]')!.click());
    expect([...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      "Manage presentation uploads",
      "Historical representation overrides",
      "Close",
    ]);
    await act(() => menuItemNamed(host, "Close")!.click());
    expect(close).toHaveBeenCalledOnce();
  });
  it("saves only an explicit historical receipt selection without approving its uploaded material", async () => {
    mockGetJson({
      identities: [],
      versions: [],
      page: { limit: 200, offset: 0, total: 0, hasMore: false },
    });
    api.postJson.mockResolvedValue({ ...snapshot, revision: 8 });
    const downloads = legacyAgendaDownloadsSchema.parse([
      {
        url: "/events/event/slides%20one.pdf",
        targetUrl: "/content-media/events/event/slides%20one.pdf",
        sourcePath: "event/index.md",
        sourceDigest: "a".repeat(64),
        sourceLocator: "agenda:1",
        pdfDigest: "b".repeat(64),
        pdfBytes: 100,
      },
      {
        url: "/events/event/unverified.pdf",
        targetUrl: "/content-media/events/event/unverified.pdf",
        sourcePath: "event/index.md",
        sourceDigest: "a".repeat(64),
        sourceLocator: "agenda:2",
      },
    ]);
    const material = sessionMaterialSchema.parse({
      id: "release",
      kind: "presentation",
      title: "Slides",
      url: "",
      presentationSource: "session",
      presentationVersionId: "uploaded-version",
      version: 1,
      rightsConfirmed: false,
      consentConfirmed: false,
      validated: false,
      status: "draft",
      approvedAt: null,
    });
    const occurrence = {
      ...snapshot.occurrences[0]!,
      history: sessionHistoryMetadataSchema.parse({ materials: [material], legacyDownloads: downloads }),
    };
    await act(async () =>
      render(
        <SessionHistoryEditor snapshot={snapshot} occurrence={occurrence} onSaved={() => {}} onClose={() => {}} />,
        host,
      ),
    );
    const choice = controlFor<HTMLSelectElement>(host, "Historical download link");
    expect(choice.value).toBe("");
    expect(optionValues(choice)).toEqual(["", ...downloads.map((download) => download.url)]);
    expect(choice.options[2]!.disabled).toBe(true);
    await chooseOption(choice, downloads[0]!.url);
    await submitForm(host);
    const body = sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[0]![1]);
    expect(body.history.legacyDownloads).toEqual(downloads);
    expect(body.history.materials[0]).toMatchObject({
      legacyDownloadUrl: downloads[0]!.url,
      status: "draft",
      rightsConfirmed: false,
      consentConfirmed: false,
      validated: false,
      approvedAt: null,
    });
    await chooseOption(choice, "");
    await submitForm(host);
    expect(
      sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[1]![1]).history.materials[0]!.legacyDownloadUrl,
    ).toBeNull();
    await chooseOption(choice, downloads[0]!.url);
    await chooseOption(controlFor(host, "Uploaded presentation version"), "");
    expect(host.textContent).not.toContain("Historical download link");
    await typeInto(controlFor(host, "Public delivery URL"), "https://media.example.test/external.pdf");
    await submitForm(host);
    const unbound = sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[2]![1]).history.materials[0]!;
    expect(unbound.legacyDownloadUrl).toBeNull();
    expect(unbound.presentationVersionId).toBeNull();
  });
  it("approves one speaker without approving the other pending speaker", async () => {
    mockGetJson({
      identities: [],
      versions: [],
      page: { limit: 200, offset: 0, total: 0, hasMore: false },
    });
    api.postJson.mockResolvedValue({ ...snapshot, revision: 8 });
    const occurrence = {
      ...snapshot.occurrences[0]!,
      speakers: [
        ...snapshot.occurrences[0]!.speakers,
        { userId: "second-speaker", displayName: "Second speaker", role: "speaker" as const },
      ],
    };
    await act(async () =>
      render(
        <SessionHistoryEditor snapshot={snapshot} occurrence={occurrence} onSaved={() => {}} onClose={() => {}} />,
        host,
      ),
    );
    const picker = [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.value === "__needs_review"),
    )!;
    await act(() => {
      picker.value = "";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() =>
      [...host.querySelectorAll("button")]
        .find((item) => item.textContent === "Approve representation for Example speaker")!
        .click(),
    );
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const body = sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[0]![1]);
    expect(body.history.appearances).toHaveLength(1);
    expect(body.history.appearances[0]!.userId).toBe("speaker");
    expect(host.textContent).toContain("Representation needs review");
  });
  it.each([null, "source-identity"])(
    "preserves the copied %s proposal representation until explicit approval",
    async (identityId) => {
      mockGetJson(async (path: string) =>
        path.includes("/history/identities")
          ? {
              identities: [
                {
                  id: "source-identity",
                  userId: "speaker",
                  organizationName: "Current organization",
                  jobTitle: "Current title",
                  biography: "Current biography",
                },
              ],
              page: { limit: 200, offset: 0, total: 1, hasMore: false },
            }
          : { versions: [], page: { limit: 200, offset: 0, total: 0, hasMore: false } },
      );
      api.postJson.mockResolvedValue({ ...snapshot, revision: 8 });
      const occurrence = {
        ...snapshot.occurrences[0]!,
        history: sessionHistoryMetadataSchema.parse({
          proposalRepresentations: [
            {
              userId: "speaker",
              actingIdentityId: identityId,
              selectedAt: "2026-01-01T00:00:00.000Z",
              snapshot: {
                organizationName: identityId ? "Source organization" : null,
                jobTitle: identityId ? "Source title" : null,
                biography: "Source biography",
                links: [],
              },
            },
          ],
        }),
      };
      await act(async () =>
        render(
          <SessionHistoryEditor snapshot={snapshot} occurrence={occurrence} onSaved={() => {}} onClose={() => {}} />,
          host,
        ),
      );
      await vi.waitFor(() => expect(host.textContent).toContain("Representation needs review"));
      const button = [...host.querySelectorAll("button")].find(
        (item) => item.textContent === "Approve representation for Example speaker",
      )!;
      expect(host.querySelector<HTMLTextAreaElement>("textarea[id]")?.value).toBe("");
      expect([...host.querySelectorAll("textarea")].some((field) => field.value === "Source biography")).toBe(true);
      await act(async () => {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      const unrelated = sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[0]![1]);
      expect(unrelated.history.appearances).toEqual([]);
      expect(unrelated.history.proposalRepresentations).toEqual(occurrence.history.proposalRepresentations);
      await act(() => button.click());
      await act(async () => {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      const approved = sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[1]![1]);
      expect(approved.history.appearances[0]).toMatchObject({
        actingIdentityId: identityId,
        organizationName: identityId ? "Source organization" : null,
        jobTitle: identityId ? "Source title" : null,
        biography: "Source biography",
      });
      expect(approved.history.appearances[0]!.approvedAt).toMatch(/Z$/u);
    },
  );
  it("leaves unrecorded speakers unapproved until an explicit representation choice", async () => {
    mockGetJson({
      identities: [],
      versions: [],
      page: { limit: 200, offset: 0, total: 0, hasMore: false },
    });
    api.postJson.mockResolvedValue({ ...snapshot, revision: 8 });
    await act(async () =>
      render(
        <SessionHistoryEditor
          snapshot={snapshot}
          occurrence={snapshot.occurrences[0]!}
          onSaved={() => {}}
          onClose={() => {}}
        />,
        host,
      ),
    );
    const approve = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Approve representation for Example speaker",
    )!;
    const picker = [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.value === "__needs_review"),
    )!;
    expect(picker.value).toBe("__needs_review");
    await act(() => approve.click());
    expect(host.textContent).toContain("Choose an individual appearance or an owned representation before approval.");
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[0]![1]).history.appearances).toEqual([]);
    await act(() => {
      picker.value = "";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => approve.click());
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[1]![1]).history.appearances[0]).toMatchObject({
      actingIdentityId: null,
      organizationName: null,
      jobTitle: null,
    });
  });
  it("binds a direct version by its source without approving rights or public release", async () => {
    mockGetJson(
      sessionMaterialVersionsSchema.parse({
        versions: ["proposal", "session"].map((source) => ({
          source,
          id: "same-version",
          title: "Slides",
          fileName: "slides.pdf",
          version: source === "session" ? 2 : 1,
          reviewStatus: "approved",
          uploadedAt: "2026-12-01T09:00:00.000Z",
        })),
        page: { limit: 200, offset: 0, total: 2, hasMore: false },
      }),
    );
    const material = sessionMaterialSchema.parse({
      id: "release",
      kind: "presentation",
      title: "Slides",
      url: "https://media.example.test/slides.pdf",
      presentationVersionId: "same-version",
      version: 1,
      rightsConfirmed: false,
      consentConfirmed: false,
      validated: false,
      status: "draft",
      approvedAt: null,
    });
    const changed = vi.fn();
    await act(() =>
      render(<MaterialFields slug="event" occurrenceId="session" materials={[material]} onChange={changed} />, host),
    );
    await vi.waitFor(() => expect(api.getJson).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const choice = [...host.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.value === "session:same-version"),
    )!;
    expect(choice.value).toBe("proposal:same-version");
    await act(() => {
      choice.value = "session:same-version";
      choice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const bound = sessionMaterialSchema.parse(changed.mock.calls[0][0][0]);
    expect(bound).toMatchObject({
      presentationSource: "session",
      presentationVersionId: "same-version",
      version: 2,
      status: "draft",
      rightsConfirmed: false,
      consentConfirmed: false,
      validated: false,
      approvedAt: null,
    });
    expect(bound.url).toBe("");
  });
  it("uses a labeled owned acting identity and submits the canonical revision guarded correction", async () => {
    mockGetJson(async (path: string) =>
      path.includes("presentations")
        ? { versions: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }
        : path.includes("appearance-overrides")
          ? { overrides: [], canReview: false, page: { limit: 50, offset: 0, total: 0, hasMore: false } }
          : {
              identities: [
                {
                  id: "identity",
                  userId: "speaker",
                  organizationName: "Historical organization",
                  jobTitle: "Engineer",
                  biography: "Approved biography",
                },
              ],
              page: { limit: 200, offset: 0, total: 1, hasMore: false },
            },
    );
    api.postJson.mockResolvedValue({ ...snapshot, revision: 8 });
    const saved = vi.fn();
    await act(async () =>
      render(
        <SessionHistoryEditor
          snapshot={snapshot}
          occurrence={snapshot.occurrences[0]!}
          onSaved={saved}
          onClose={() => {}}
        />,
        host,
      ),
    );
    await vi.waitFor(() => expect(api.getJson).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("table")).toBeNull();
    const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Session archive actions"]')!.click());
    await act(() => {
      button("Historical representation overrides").click();
    });
    await vi.waitFor(() => expect(button("Request historical representation review")).toBeDefined());
    expect(host.querySelector("form")).toBeNull();
    await act(async () => {
      button("Request historical representation review").click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.querySelector("table")).toBeNull());
    expect(host.querySelector("form")).not.toBeNull();
    await act(async () => {
      button("Back to archive details").click();
      await Promise.resolve();
    });
    const historicalPicker = () =>
      Array.from(host.querySelectorAll("select")).find((select) =>
        Array.from(select.options).some((option) => option.textContent?.includes("Historical organization")),
      );
    await vi.waitFor(() => expect(historicalPicker()).toBeDefined());
    const picker = historicalPicker()!;
    await act(async () => {
      picker.value = "identity";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => button("Approve representation for Example speaker").click());
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.postJson).toHaveBeenCalledOnce();
    const body = sessionHistoryCorrectionSchema.parse(api.postJson.mock.calls[0]![1]);
    expect(body.expectedRevision).toBe(7);
    expect(body.history.appearances[0]).toMatchObject({
      actingIdentityId: "identity",
      organizationName: "Historical organization",
      jobTitle: "Engineer",
    });
    expect(saved).toHaveBeenCalledOnce();
  });
});
