// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { PresentationVersionsTab } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/PresentationVersionsTab";
import type { PresentationVersion } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/model";
import { presentationVersionReviewRequestSchema } from "../../assets/shared/schemas/presentation-versions";
import { markdownControl, typeMarkdown, controlFor } from "./helpers/labelled-control";

// Identifiers are the shape `databaseIdSchema` accepts, because the saved
// review is parsed back through the shared response schema.
const PROPOSAL_ID = "0000000000000000000000000000aaaa";
const VERSION_ID = "1111111111111111111111111111bbbb";
const REVIEW_FORM_ID = `presentation-review-${VERSION_ID}`;

const version: PresentationVersion = {
  id: VERSION_ID,
  proposalId: PROPOSAL_ID,
  versionNumber: 1,
  fileName: "pqc-migration-talk.pdf",
  fileSize: 2048,
  mimeType: "application/pdf",
  uploadedByUserId: "2222222222222222222222222222cccc",
  uploadedAt: "2026-08-01T09:00:00.000Z",
  isCurrent: true,
  deletedAt: null,
  latestReview: {
    id: "3333333333333333333333333333dddd",
    versionId: VERSION_ID,
    reviewedByUserId: "4444444444444444444444444444eeee",
    reviewedAt: "2026-08-02T09:00:00.000Z",
    status: "needs_revision",
    note: "Please add speaker notes to each slide.",
  },
};

let container: HTMLElement | null = null;

async function mount(props: Partial<Parameters<typeof PresentationVersionsTab>[0]> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(<PresentationVersionsTab proposalId={PROPOSAL_ID} canManage {...props} />, container!));
  await settle();
  return container!;
}

function buttonNamed(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

async function openReviewForm(root: HTMLElement) {
  await act(() => buttonNamed(root, "Review").click());
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Stubs fetch with one answer and records every request body. */
function stubFetch(respond: () => Response, versions: PresentationVersion[] = [version]): string[] {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return jsonResponse({ versions, page: { limit: 25, offset: 0, total: versions.length, hasMore: false } });
      }
      bodies.push(init.body?.toString() ?? "");
      return respond();
    }),
  );
  return bodies;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Types into the shared Markdown editor and hands back its source control, the one the label then points at. */
async function typeNote(root: HTMLElement, value: string): Promise<HTMLTextAreaElement> {
  await typeMarkdown(root, "Note for the speaker", value);
  return controlFor<HTMLTextAreaElement>(root, "Note for the speaker");
}

function fieldOf(control: HTMLElement): HTMLElement {
  return control.closest<HTMLElement>(".pk-field")!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

beforeEach(() => {
  stubFetch(() => jsonResponse({ version }));
});

describe("presentation versions tab", () => {
  it("renders versions in a paged table with named actions and review details", async () => {
    const root = await mount();

    const table = root.querySelector("table") as HTMLTableElement;
    expect(table.querySelector("caption")?.textContent).toBe("Presentation versions");
    const headers = [...table.querySelectorAll("thead th")].map((head) =>
      head.textContent?.replace(/[↑↓]/g, "").trim(),
    );
    expect(headers).toEqual(["Version", "File", "Uploaded", "Size", "Review", "Actions"]);
    const row = table.querySelector("tbody tr") as HTMLTableRowElement;
    expect(row.textContent).toContain("Version 1");
    expect(row.textContent).toContain("pqc-migration-talk.pdf");
    expect(row.textContent).toContain("2 KB");
    expect(table.querySelector(".pk-table__detail")?.textContent).toContain("Please add speaker notes");

    // The end-to-end spec reads the review outcome through this hook, and it
    // has to stay a word rather than a colour.
    expect(root.querySelector("[data-presentation-review-status]")?.textContent).toBe("Needs revision");

    // The download is a destination drawn as a button: the design system's
    // link, with the same classes a Button beside it carries.
    const download = [...row.querySelectorAll("a")].find((link) => link.textContent === "Download");
    expect(download?.classList.contains("pk-btn")).toBe(true);
    expect(download?.hasAttribute("download")).toBe(true);

    // The disclosure says, in markup, what it controls and whether it is open.
    const reviewButton = buttonNamed(root, "Review");
    expect(reviewButton.getAttribute("aria-expanded")).toBe("false");
    expect(reviewButton.getAttribute("aria-controls")).toBe(REVIEW_FORM_ID);
  });

  it("labels every review control and points each label at its own field", async () => {
    const root = await mount();
    await openReviewForm(root);

    expect(root.querySelector(`#${REVIEW_FORM_ID}`)).not.toBeNull();
    expect(buttonNamed(root, "Review").getAttribute("aria-expanded")).toBe("true");

    // The note is the shared Markdown editor, a lazy chunk; its label points
    // at nothing until it is on the page.
    const note = await markdownControl(root, "Note for the speaker");
    const labels = [...root.querySelectorAll("label.pk-field__label")];
    expect(labels.map((label) => label.textContent)).toEqual(["Review outcome", "Note for the speaker"]);
    for (const label of labels) {
      const controlId = label.getAttribute("for");
      expect(controlId).toBeTruthy();
      expect(root.querySelector(`#${controlId}`)).not.toBeNull();
    }

    const select = root.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["approved", "needs_revision", "rejected"]);

    // Help text is wired to the control it explains, not merely placed near it.
    const helpId = note.getAttribute("aria-describedby");
    expect(helpId).toBeTruthy();
    expect(root.querySelector(`#${helpId}`)?.textContent).toContain("The speaker sees this");
    expect(note.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("sends the review the shared request schema describes", async () => {
    const bodies = stubFetch(() => jsonResponse({ version }));
    const root = await mount();
    await openReviewForm(root);

    const select = root.querySelector("select") as HTMLSelectElement;
    await act(() => {
      select.value = "needs_revision";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await typeNote(root, "  Please add speaker notes.  ");
    await act(() => buttonNamed(root, "Save review").click());
    await settle();

    expect(bodies).toHaveLength(1);
    // The contract, not a literal: the body has to satisfy the schema the
    // endpoint validates against.
    const parsed = presentationVersionReviewRequestSchema.parse(JSON.parse(bodies[0]));
    expect(parsed).toEqual({ status: "needs_revision", note: "Please add speaker notes." });
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method || init.method === "GET").length,
    ).toBeGreaterThan(1);
    // A saved review closes its own form.
    expect(root.querySelector(`#${REVIEW_FORM_ID}`)).toBeNull();
  });

  it("refuses a note the contract rejects on the field, live, and sends nothing", async () => {
    const bodies = stubFetch(() => jsonResponse({ version }));
    const root = await mount();
    await openReviewForm(root);

    // The contract caps the note; the field says so as it is typed, before
    // Save is pressed, and Save then sends nothing.
    const textarea = await typeNote(root, "x".repeat(4001));
    expect(fieldOf(textarea).classList.contains("pk-field--invalid")).toBe(true);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    const messageId = textarea.getAttribute("aria-describedby");
    expect(root.querySelector(`#${messageId}`)?.getAttribute("role")).toBe("alert");

    await act(() => buttonNamed(root, "Save review").click());
    await settle();
    expect(bodies).toHaveLength(0);
    expect(root.querySelector(`#${REVIEW_FORM_ID}`)).not.toBeNull();

    // Corrected: the same field says it is good now.
    await typeNote(root, "Short and clear.");
    expect(fieldOf(textarea).classList.contains("pk-field--ok")).toBe(true);
  });

  it("marks the field a server refusal names, and keeps the form open", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION",
            message: "Invalid request",
            details: { fieldErrors: { note: ["The note must not contain a URL."] } },
          },
        },
        400,
      ),
    );
    const root = await mount();
    await openReviewForm(root);
    await typeNote(root, "See https://example.test");
    await act(() => buttonNamed(root, "Save review").click());
    await settle();

    // The form stays open with the reviewer's work in it, and the field the
    // server named carries its reason.
    expect(root.querySelector(`#${REVIEW_FORM_ID}`)).not.toBeNull();
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("See https://example.test");
    expect(fieldOf(textarea).classList.contains("pk-field--invalid")).toBe(true);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    const message = root.querySelector(`#${textarea.getAttribute("aria-describedby")}`) as HTMLElement;
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toContain("The note must not contain a URL.");
  });

  it("states a refusal the server does not attribute to a field inside the form", async () => {
    stubFetch(() => jsonResponse({ error: { code: "FORBIDDEN", message: "You cannot review this version." } }, 403));
    const root = await mount();
    await openReviewForm(root);
    await act(() => buttonNamed(root, "Save review").click());
    await settle();

    // The form stays open; the fields said nothing wrong, so neither is
    // marked, and the refusal is announced where the reviewer is working.
    const form = root.querySelector(`#${REVIEW_FORM_ID}`) as HTMLElement;
    expect(form).not.toBeNull();
    expect((await markdownControl(form, "Note for the speaker")).getAttribute("aria-invalid")).not.toBe("true");
    const alert = form.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("You cannot review this version.");
  });

  it("states an upload failure in a live region above the list", async () => {
    stubFetch(() => jsonResponse({ error: { code: "TOO_LARGE", message: "That file is too large." } }, 413));
    const root = await mount();

    const fileInput = root.querySelector('input[type="file"]') as HTMLInputElement;
    // The input is taken out of the page with the platform's own attribute,
    // not a utility class a stylesheet has to be present to honour.
    expect(fileInput.hidden).toBe(true);

    const file = new File(["slides"], "deck.pdf", { type: "application/pdf" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(() => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const alert = root.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("That file is too large.");
  });

  it("keeps an empty table and hides upload from a reader who cannot manage", async () => {
    stubFetch(() => jsonResponse({ version }), []);
    const root = await mount({ canManage: false });

    expect(root.querySelector(".pk-table__empty")?.textContent).toContain("No presentation uploaded yet.");
    expect(root.querySelector('input[type="file"]')).toBeNull();

    void act(() => render(null, container!));
    void act(() => render(<PresentationVersionsTab proposalId={PROPOSAL_ID} canManage />, container!));
    expect(buttonNamed(container!, "Upload on behalf of speaker")).toBeTruthy();
  });
});
