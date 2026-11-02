// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { PictureTile, type PictureTileProps } from "../../assets/ts/components/PictureTile";
import { PasskeySettings } from "../../assets/ts/components/passkey-settings";
import { ProposalSpeakerCard } from "../../assets/ts/components/proposals/ProposalSpeakerCard";
import type { ProposalSpeaker } from "../../assets/shared/schemas/proposal-speakers";
import { passkeyDeleteQuerySchema } from "../../assets/shared/schemas/passkeys";
import { LAST_PASSKEY_MESSAGE, LAST_SIGN_IN_METHOD } from "../../assets/shared/auth-errors";
import { controlFor, labelNames } from "./helpers/labeled-control";
import { beginRecordEdit } from "./helpers/record-edit";
import { rowActionControlNames, runCardAction, runRowAction } from "./helpers/row-actions";

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

describe("PictureTile logo confirmation", () => {
  function props(overrides: Partial<PictureTileProps> = {}): PictureTileProps {
    return {
      name: "Example Corp",
      canChange: true,
      imageUrl: "https://example.test/logo.png",
      alt: "Example Corp logo",
      removeConfirmation: "Remove this organization's logo?",
      accept: "image/svg+xml",
      onUpload: vi.fn(async () => undefined),
      onRemove: vi.fn(async () => undefined),
      onChanged: vi.fn(),
      toast: vi.fn(),
      ...overrides,
    };
  }

  /** A control named for what it does to whose logo, the way a screen reader hears it. */
  function namedControl(container: HTMLElement, name: string): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    if (!button) throw new Error(`missing control: ${name}`);
    return button;
  }

  it("draws the change cue at rest inside the control, for editors only", () => {
    const editable = mount(<PictureTile {...props()} />);
    const cue = namedControl(editable, "Change logo of Example Corp").querySelector(".pk-picture-tile__cue");
    expect(cue?.getAttribute("aria-hidden")).toBe("true");
    expect(cue?.querySelector("svg")).not.toBeNull();

    const readOnly = mount(<PictureTile {...props({ canChange: false })} />);
    expect(readOnly.querySelector(".pk-picture-tile__cue")).toBeNull();
  });

  it("removes the logo only after the named confirmation is accepted", async () => {
    const onRemove = vi.fn(async () => undefined);
    const container = mount(
      <>
        <ConfirmDialogHost />
        <PictureTile {...props({ onRemove })} />
      </>,
    );

    await act(() => namedControl(container, "Remove logo of Example Corp").click());
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
        <PictureTile {...props({ onRemove })} />
      </>,
    );

    await act(() => namedControl(container, "Remove logo of Example Corp").click());
    await act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(onRemove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("is itself the control, named for the organization, with the upload policy tied to it", () => {
    const container = mount(<PictureTile {...props({ hint: "SVG only. The logo is sanitized automatically." })} />);

    const control = namedControl(container, "Change logo of Example Corp");
    expect(container.querySelector(`#${control.getAttribute("aria-describedby")!}`)?.textContent).toBe(
      "SVG only. The logo is sanitized automatically.",
    );
    // The SVG-only policy reaches the picker, not only the sentence.
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe("image/svg+xml");
    // No full-width command buttons stand beside the picture.
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Remove logo");
  });

  it("offers to upload when there is no logo yet, and nothing to remove", () => {
    const container = mount(<PictureTile {...props({ imageUrl: null })} />);

    expect(namedControl(container, "Upload logo of Example Corp")).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector('button[aria-label^="Remove"]')).toBeNull();
  });

  it("offers no removal where the surface cannot remove the logo", () => {
    const container = mount(<PictureTile {...props({ onRemove: undefined })} />);

    expect(namedControl(container, "Change logo of Example Corp")).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector('button[aria-label^="Remove"]')).toBeNull();
  });

  it("reports a refused upload through the caller's notifier and resets the file control", async () => {
    const toast = vi.fn();
    const onChanged = vi.fn();
    const container = mount(
      <PictureTile
        {...props({
          toast,
          onChanged,
          onUpload: vi.fn(async () => {
            throw new Error("That file is not an SVG.");
          }),
        })}
      />,
    );

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["<svg />"], "logo.svg", { type: "image/svg+xml" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast).toHaveBeenCalledWith("That file is not an SVG.", "error");
    expect(onChanged).not.toHaveBeenCalled();
    // The control is remounted after every attempt, so the rejected file is
    // not left sitting in it as though it took.
    expect(container.querySelector('input[type="file"]')).not.toBe(input);
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

    // A passkey list is a column of "Remove" controls, so each one says which
    // key it would remove rather than leaving that to the row it sits in.
    expect(rowActionControlNames(container)).toEqual(["Actions for Work laptop"]);
    await runRowAction(container, "Work laptop", "Remove");

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Remove passkey "Work laptop"?');

    await act(() => dialogButton(container, "Remove passkey").click());
    await settle();

    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  function lastWayRefusal(): Response {
    return Response.json(
      { error: { code: LAST_SIGN_IN_METHOD, message: LAST_PASSKEY_MESSAGE, details: null } },
      { status: 409 },
    );
  }

  async function removeWorkLaptop(): Promise<HTMLElement> {
    const container = mount(
      <>
        <ConfirmDialogHost />
        <PasskeySettings toastTargetId="toast" />
      </>,
    );
    await settle();
    await runRowAction(container, "Work laptop", "Remove");
    await act(() => dialogButton(container, "Remove passkey").click());
    await settle();
    return container;
  }

  it("removes the last way to sign in only after a second, explicit warning", async () => {
    const deletes: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "DELETE") return passkeysResponse();
        const url = new URL(String(input), "https://app.test");
        deletes.push(url);
        const query = passkeyDeleteQuerySchema.parse(Object.fromEntries(url.searchParams));
        return query.confirmLastMethod ? Response.json({ success: true }) : lastWayRefusal();
      }),
    );

    const container = await removeWorkLaptop();

    // The refusal becomes a warning that says what is lost; nothing is removed yet.
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Remove your last way to sign in?");
    expect(deletes).toHaveLength(1);

    await act(() => dialogButton(container, "Remove passkey").click());
    await settle();

    expect(deletes).toHaveLength(2);
    expect(passkeyDeleteQuerySchema.parse(Object.fromEntries(deletes[1].searchParams))).toEqual({
      confirmLastMethod: true,
    });
    // The replacement is offered at once, while this session still signs in.
    expect(container.querySelector("dialog[open]")?.textContent).toContain("Add a passkey");
  });

  it("keeps the passkey when the last-way warning is cancelled", async () => {
    let deletes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "DELETE") return passkeysResponse();
        deletes += 1;
        return lastWayRefusal();
      }),
    );

    const container = await removeWorkLaptop();
    await act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(deletes).toBe(1);
  });

  it("names the list and the device-name field instead of leaving both anonymous", async () => {
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

    // A page of unnamed lists is announced as a list of "list"s.
    expect(container.querySelector("ul")?.getAttribute("aria-label")).toBe("Passkeys");
    expect(container.textContent).toContain("Never used");
    // The Bootstrap version's <label> carried no `for`, and the input carried
    // no id, so the field announced nothing at all.
    const field = controlFor(container, "Device name (optional)");
    expect(field.tagName).toBe("INPUT");
    expect(labelNames(container)).toContain("Device name (optional)");
  });

  it("opens the add form in a dialog from the panel menu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => passkeysResponse()),
    );
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredentialStub() {
      /* presence is the whole capability check */
    });
    const container = mount(<PasskeySettings toastTargetId="toast" />);
    await settle();

    const dialog = container.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(false);
    await beginRecordEdit(container, "Passkeys actions", "Add a passkey");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector(".pk-input-group")).not.toBeNull();
  });

  it("states a failed passkey list as a sentence and shows no list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 })),
    );
    const container = mount(<PasskeySettings toastTargetId="toast" />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(container.querySelector("ul")).toBeNull();
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
      actingIdentityId: null,
      actingIdentitySelectedAt: null,
      actingIdentitySelection: "unrecorded",
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
          canFinalize
          isCurrentProposer={false}
          replacementSpeakers={[{ userId: "00000000-0000-4000-8000-000000000022", label: "Backup Speaker" }]}
          endpoints={{
            speakerPath: (proposalId, userId, suffix = "") =>
              `/api/v1/proposals/${proposalId}/speakers/${userId}${suffix ? `/${suffix}` : ""}`,
          }}
          onSaved={vi.fn()}
          onRemoved={onRemoved}
        />
      </>,
    );

    // Removal is a command in the card's own actions menu, not a button in
    // its body.
    await runCardAction(container, "Dana Yu", "Remove speaker");

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
          canFinalize
          isCurrentProposer={false}
          replacementSpeakers={[{ userId: "00000000-0000-4000-8000-000000000022", label: "Backup Speaker" }]}
          endpoints={{
            speakerPath: (proposalId, userId, suffix = "") =>
              `/api/v1/proposals/${proposalId}/speakers/${userId}${suffix ? `/${suffix}` : ""}`,
          }}
          onSaved={vi.fn()}
          onRemoved={onRemoved}
        />
      </>,
    );

    // Removal is a command in the card's own actions menu, not a button in
    // its body.
    await runCardAction(container, "Dana Yu", "Remove speaker");
    await act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(onRemoved).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
