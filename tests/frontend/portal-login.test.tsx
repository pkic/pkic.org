/**
 * The portal sign-in screen, after it moved onto the design system.
 *
 * What is worth asserting here is not that a card renders. It is the part a
 * visual review cannot see and the part the end-to-end specs now depend on:
 * the label and the control are joined by `for`/`id` (the specs locate the
 * field by its accessible name, not by a hand-written id any more), a failed
 * send is announced rather than merely colored, and the request body is the
 * shape the shared contract describes.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authenticateWithPasskey = vi.fn<() => Promise<unknown>>();
const browserSupportsWebAuthn = vi.fn<() => boolean>();

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
}));
vi.mock("../../assets/ts/shared/passkey-authentication", () => ({
  authenticateWithPasskey: () => authenticateWithPasskey(),
}));

const { Login } = await import("../../assets/ts/member-flows/portal/shell/Login");
const { userAuthRequestSchema } = await import("../../assets/shared/schemas/user-auth");

let container: HTMLDivElement;

/** Drives the scheduler until `condition` holds, or fails saying it never did. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(condition(), what).toBe(true);
}

/**
 * The control a visible label points at. Resolving it through `for`/`id` is
 * the assertion as much as the lookup: a field whose label is decorative
 * returns nothing here, which is exactly what a screen reader would find.
 */
function controlLabeled(labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((el) =>
    (el.textContent ?? "").trim().startsWith(labelText),
  );
  expect(label, `no label reading "${labelText}"`).toBeTruthy();
  const id = label!.getAttribute("for");
  expect(id, `the "${labelText}" label points at nothing`).toBeTruthy();
  const control = container.querySelector<HTMLInputElement>(`#${id!}`);
  expect(control, `no control with id "${id!}"`).toBeTruthy();
  return control!;
}

function buttonLabeled(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((el) => (el.textContent ?? "").trim() === text);
  expect(button, `no button reading "${text}"`).toBeTruthy();
  return button!;
}

function submitForm(): Promise<void> {
  return act(async () => {
    container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit"));
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  browserSupportsWebAuthn.mockReturnValue(false);
  authenticateWithPasskey.mockReset();
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("portal login", () => {
  it("joins the email label to its control and requests a link with the shared contract's body", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ success: true });
      }),
    );

    await act(() => render(<Login onSignedIn={vi.fn()} />, container));

    const email = controlLabeled("Email");
    expect(email.type).toBe("email");
    expect(email.required).toBe(true);
    expect(email.getAttribute("autocomplete")).toBe("email");
    // Nothing has been submitted, so the field must not claim to be in error.
    expect(email.getAttribute("aria-invalid")).toBeNull();

    email.value = "member@example.test";
    await submitForm();
    await waitFor(() => container.querySelector('[role="status"]') !== null, "the send was never confirmed");

    expect(bodies).toHaveLength(1);
    // The literal is a tautology; the contract is not.
    expect(userAuthRequestSchema.parse(bodies[0])).toEqual({ email: "member@example.test" });

    const confirmation = container.querySelector('[role="status"]');
    expect(confirmation?.textContent).toContain("you'll receive a sign-in link shortly");
    // The confirmation replaces the form, so there is nothing left to submit.
    expect(container.querySelector("form")).toBeNull();
  });

  it("announces a failed send instead of only coloring it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "RATE_LIMITED", message: "Too many sign-in attempts." } }, { status: 429 }),
      ),
    );

    await act(() => render(<Login onSignedIn={vi.fn()} />, container));
    controlLabeled("Email").value = "member@example.test";
    await submitForm();
    await waitFor(() => container.querySelector('[role="alert"]') !== null, "the failure was never announced");

    const alert = container.querySelector('[role="alert"]');
    expect(alert, "a failed send must be announced, not merely tinted").toBeTruthy();
    expect(alert!.textContent).toContain("Sign-in failed: Too many sign-in attempts.");
    // The form stays put so the address can be corrected and retried.
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("offers the passkey ceremony as a real button and reports its failure", async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    authenticateWithPasskey.mockRejectedValue(new Error("No passkey was selected."));
    const onSignedIn = vi.fn();

    await act(() => render(<Login onSignedIn={onSignedIn} />, container));

    const passkey = buttonLabeled("Sign in with a passkey");
    expect(passkey.tagName).toBe("BUTTON");
    expect(passkey.type).toBe("button");

    await act(async () => {
      passkey.click();
      await Promise.resolve();
    });
    await waitFor(() => container.querySelector('[role="alert"]') !== null, "the failure was never announced");

    expect(onSignedIn).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Sign-in failed: No passkey was selected.",
    );
  });

  it("hides the passkey option where the browser cannot perform the ceremony", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    await act(() => render(<Login onSignedIn={vi.fn()} />, container));

    expect(
      Array.from(container.querySelectorAll("button")).some((el) =>
        (el.textContent ?? "").includes("Sign in with a passkey"),
      ),
    ).toBe(false);
    expect(controlLabeled("Email")).toBeTruthy();
  });
});
