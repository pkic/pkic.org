// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { PresentationVersionsTab } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/PresentationVersionsTab";
import type { PresentationVersion } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/model";
import { presentationVersionReviewRequestSchema } from "../../assets/shared/schemas/presentation-versions";

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

function mount(props: Partial<Parameters<typeof PresentationVersionsTab>[0]> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  void act(() =>
    render(
      <PresentationVersionsTab
        proposalId={PROPOSAL_ID}
        versions={[version]}
        loading={false}
        hasMore={false}
        loadingMore={false}
        canManage
        onLoadMore={() => {}}
        onReload={() => {}}
        {...props}
      />,
      container!,
    ),
  );
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
function stubFetch(respond: () => Response): string[] {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body?.toString() ?? "");
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

async function typeNote(root: HTMLElement, value: string): Promise<HTMLTextAreaElement> {
  const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
  await act(() => {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
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

describe("presentation versions tab", () => {
  it("names each version region and its metadata for assistive technology", () => {
    const root = mount();

    const card = root.querySelector("[data-presentation-version-card]") as HTMLElement;
    // The card is a named region, so the three identically labelled controls
    // inside it are announced with the version they act on.
    expect(card.tagName).toBe("SECTION");
    expect(card.getAttribute("aria-label")).toBe("Presentation version 1");
    expect(card.querySelector("h3")?.textContent).toBe("Version 1");

    // Every value is announced with the term that names it, rather than as a
    // run of text separated by middots.
    const terms = [...card.querySelectorAll("dl.pk-datalist > dt")].map((dt) => dt.textContent);
    expect(terms).toEqual(["Uploaded", "File", "Type", "Size"]);
    const values = [...card.querySelectorAll("dl.pk-datalist > dd")].map((dd) => dd.textContent);
    expect(values).toContain("pqc-migration-talk.pdf");
    expect(values).toContain("2 KB");

    // The end-to-end spec reads the review outcome through this hook, and it
    // has to stay a word rather than a colour.
    expect(root.querySelector("[data-presentation-review-status]")?.textContent).toBe("Needs revision");

    // The download is a destination drawn as a button: the design system's
    // link, with the same classes a Button beside it carries.
    const download = [...card.querySelectorAll("a")].find((link) => link.textContent === "Download");
    expect(download?.classList.contains("pk-btn")).toBe(true);
    expect(download?.hasAttribute("download")).toBe(true);

    // The disclosure says, in markup, what it controls and whether it is open.
    const reviewButton = buttonNamed(root, "Review");
    expect(reviewButton.getAttribute("aria-expanded")).toBe("false");
    expect(reviewButton.getAttribute("aria-controls")).toBe(REVIEW_FORM_ID);
  });

  it("labels every review control and points each label at its own field", async () => {
    const root = mount();
    await openReviewForm(root);

    expect(root.querySelector(`#${REVIEW_FORM_ID}`)).not.toBeNull();
    expect(buttonNamed(root, "Review").getAttribute("aria-expanded")).toBe("true");

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
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    const helpId = textarea.getAttribute("aria-describedby");
    expect(helpId).toBeTruthy();
    expect(root.querySelector(`#${helpId}`)?.textContent).toContain("The speaker sees this");
    expect(textarea.hasAttribute("aria-invalid")).toBe(false);
  });

  it("sends the review the shared request schema describes", async () => {
    const bodies = stubFetch(() => jsonResponse({ version }));
    const reloads: number[] = [];
    const root = mount({ onReload: () => reloads.push(1) });
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
    expect(reloads).toHaveLength(1);
    // A saved review closes its own form.
    expect(root.querySelector(`#${REVIEW_FORM_ID}`)).toBeNull();
  });

  it("refuses a note the contract rejects on the field, live, and sends nothing", async () => {
    const bodies = stubFetch(() => jsonResponse({ version }));
    const root = mount();
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
    const root = mount();
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
    const root = mount();
    await openReviewForm(root);
    await act(() => buttonNamed(root, "Save review").click());
    await settle();

    // The form stays open; the fields said nothing wrong, so neither is
    // marked, and the refusal is announced where the reviewer is working.
    const form = root.querySelector(`#${REVIEW_FORM_ID}`) as HTMLElement;
    expect(form).not.toBeNull();
    expect(form.querySelector("textarea")?.getAttribute("aria-invalid")).toBeNull();
    const alert = form.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("You cannot review this version.");
  });

  it("states an upload failure in a live region above the list", async () => {
    stubFetch(() => jsonResponse({ error: { code: "TOO_LARGE", message: "That file is too large." } }, 413));
    const root = mount();

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

  it("offers the upload from the empty state and hides it from a reader who cannot manage", () => {
    const root = mount({ versions: [], canManage: false });

    const status = root.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain("No presentation uploaded yet.");
    expect(root.querySelector('input[type="file"]')).toBeNull();

    void act(() => render(null, container!));
    void act(() =>
      render(
        <PresentationVersionsTab
          proposalId={PROPOSAL_ID}
          versions={[]}
          loading={false}
          hasMore={false}
          loadingMore={false}
          canManage
          onLoadMore={() => {}}
          onReload={() => {}}
        />,
        container!,
      ),
    );
    expect(buttonNamed(container!, "Upload on behalf of speaker")).toBeTruthy();
  });
});
