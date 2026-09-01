// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { LogoManager } from "../../assets/ts/components/LogoManager";
import { PasskeySettings } from "../../assets/ts/components/passkey-settings";
import { ProposalSpeakerCard } from "../../assets/ts/components/proposals/ProposalSpeakerCard";
import type { ProposalSpeaker } from "../../assets/shared/schemas/proposal-speakers";
import { controlFor, labelNames } from "./helpers/labelled-control";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

/** A button on the page, outside the confirm dialog (which may reuse the same label). */
function pageButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label && !candidate.closest('[role="alertdialog"]'),
  );
  if (!button) throw new Error(`missing page button: ${label}`);
  return button;
}

/** A button inside the open confirm dialog. */
function dialogButton(container: HTMLElement, label: string): HTMLButtonElement {
  const dialog = container.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  return findButton(dialog, label);
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("LogoManager confirmation", () => {
  function props(overrides: Partial<Parameters<typeof LogoManager>[0]> = {}) {
    return {
      imageUrl: "https://example.test/logo.png",
      alt: "Example Corp logo",
      layout: "inline" as const,
      imageClass: "logo",
      placeholderClass: "logo-placeholder",
      removeConfirmation: "Remove this organization's logo?",
      removeLabel: "Remove logo",
      onUpload: vi.fn(async () => undefined),
      onRemove: vi.fn(async () => undefined),
      onChanged: vi.fn(),
      toast: vi.fn(),
      ...overrides,
    };
  }

  it("removes the logo only after the named confirmation is accepted", async () => {
    const onRemove = vi.fn(async () => undefined);
    const container = mount(
      <>
        <ConfirmDialogHost />
        <LogoManager {...props({ onRemove })} />
      </>,
    );

    await act(() => pageButton(container, "Remove logo").click());
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove this organization's logo?");
    expect(onRemove).not.toHaveBeenCalled();

    await act(() => dialogButton(container, "Remove logo").click());
    await settle();

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps the logo when the confirmation is cancelled", async () => {
    const onRemove = vi.fn(async () => undefined);
    const container = mount(
      <>
        <ConfirmDialogHost />
        <LogoManager {...props({ onRemove })} />
      </>,
    );

    await act(() => pageButton(container, "Remove logo").click());
    await act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(onRemove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("PasskeySettings confirmation and row actions", () => {
  function passkeysResponse(): Response {
    return new Response(
      JSON.stringify({
        passkeys: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            deviceName: "Work laptop",
            aaguid: null,
            lastUsedAt: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("removes a passkey through the row menu and the named confirmation", async () => {
    const requests: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requests.push({ method: init?.method ?? "GET", url });
        if (url.endsWith("/passkeys")) return passkeysResponse();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const container = mount(
      <>
        <ConfirmDialogHost />
        <PasskeySettings toastTargetId="toast" />
      </>,
    );
    await settle();

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for Work laptop"]');
    if (!trigger) throw new Error("missing row actions trigger");
    await act(() => trigger.click());
    const removeItem = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Remove",
    );
    if (!removeItem) throw new Error("missing Remove menu item");
    await act(() => removeItem.click());

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Remove passkey "Work laptop"?');

    await act(() => dialogButton(container, "Remove passkey").click());
    await settle();

    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("names the table and the device-name field instead of leaving both anonymous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => passkeysResponse()),
    );
    // jsdom has no WebAuthn, so the enrolment form is only offered once the
    // capability check the component runs can find it.
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredentialStub() {
      /* presence is the whole capability check */
    });
    const container = mount(<PasskeySettings toastTargetId="toast" />);
    await settle();

    // A page of unnamed tables is announced as a list of "table"s.
    expect(container.querySelector("caption")?.textContent).toBe("Passkeys registered to this account");
    // The Bootstrap version's <label> carried no `for`, and the input carried
    // no id, so the field announced nothing at all.
    const field = controlFor(container, "Device name (optional)");
    expect(field.tagName).toBe("INPUT");
    expect(labelNames(container)).toContain("Device name (optional)");
  });

  it("states a failed passkey list as a sentence and shows no table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 })),
    );
    const container = mount(<PasskeySettings toastTargetId="toast" />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("says so, once, when the browser has no passkey support", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => passkeysResponse()),
    );
    // jsdom carries no WebAuthn, which is the unsupported case verbatim: the
    // enrolment form must not be offered, and the reason must be stated.
    const container = mount(<PasskeySettings toastTargetId="toast" />);
    await settle();

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("This browser doesn't support passkeys.");
  });
});

describe("ProposalSpeakerCard confirmation", () => {
  function speaker(overrides: Partial<ProposalSpeaker> = {}): ProposalSpeaker {
    return {
      userId: "00000000-0000-4000-8000-000000000021",
      role: "speaker",
      status: "confirmed",
      email: "dana@example.test",
      firstName: "Dana",
      lastName: "Yu",
      organizationName: null,
      jobTitle: null,
      links: [],
      headshotUpdatedAt: null,
      headshotUrl: null,
      confirmedAt: null,
      declinedAt: null,
      declineReason: null,
      termsAcceptedAt: null,
      inviteExpiresAt: null,
      addedAt: "2026-08-01T00:00:00.000Z",
      biography: null,
      profileComplete: true,
      hasHeadshot: false,
      hasBio: false,
      ...overrides,
    };
  }

  it("removes a speaker only after the named confirmation is accepted", async () => {
    const requests: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requests.push({ method: init?.method ?? "GET", url });
        return new Response(
          JSON.stringify({
            success: true,
            removedUserId: "00000000-0000-4000-8000-000000000021",
            proposerUserId: "00000000-0000-4000-8000-000000000022",
            cancelledEmailCount: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const onRemoved = vi.fn();

    const container = mount(
      <>
        <ConfirmDialogHost />
        <ProposalSpeakerCard
          speaker={speaker()}
          proposalId="00000000-0000-4000-8000-000000000099"
          canEdit={false}
          canFinalize
          isCurrentProposer={false}
          replacementSpeakers={[{ userId: "00000000-0000-4000-8000-000000000022", label: "Backup Speaker" }]}
          endpoints={{
            speakerPath: (proposalId, userId, suffix = "") =>
              `/api/v1/proposals/${proposalId}/speakers/${userId}${suffix ? `/${suffix}` : ""}`,
            assetPath: (proposalId, userId, asset) => `/api/v1/proposals/${proposalId}/speakers/${userId}/${asset}`,
          }}
          onSaved={vi.fn()}
          onRemoved={onRemoved}
        />
      </>,
    );

    const removeButton = container.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]");
    if (!removeButton) throw new Error("missing remove-speaker button");
    await act(() => removeButton.click());

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove Dana Yu from this proposal?");
    expect(onRemoved).not.toHaveBeenCalled();

    await act(() => dialogButton(container, "Remove speaker").click());
    await settle();

    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("keeps the speaker on the roster when the confirmation is cancelled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onRemoved = vi.fn();

    const container = mount(
      <>
        <ConfirmDialogHost />
        <ProposalSpeakerCard
          speaker={speaker()}
          proposalId="00000000-0000-4000-8000-000000000099"
          canEdit={false}
          canFinalize
          isCurrentProposer={false}
          replacementSpeakers={[{ userId: "00000000-0000-4000-8000-000000000022", label: "Backup Speaker" }]}
          endpoints={{
            speakerPath: (proposalId, userId, suffix = "") =>
              `/api/v1/proposals/${proposalId}/speakers/${userId}${suffix ? `/${suffix}` : ""}`,
            assetPath: (proposalId, userId, asset) => `/api/v1/proposals/${proposalId}/speakers/${userId}/${asset}`,
          }}
          onSaved={vi.fn()}
          onRemoved={onRemoved}
        />
      </>,
    );

    const removeButton = container.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]");
    if (!removeButton) throw new Error("missing remove-speaker button");
    await act(() => removeButton.click());
    await act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(onRemoved).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
