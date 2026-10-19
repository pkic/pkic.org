import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const startRegistration = vi.fn();
let webAuthn = true;
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => webAuthn,
  startRegistration: (...args: unknown[]) => startRegistration(...args),
}));
const { PasskeyOffer, passkeyOfferDue } = await import("../../assets/ts/member-flows/portal/shell/PasskeyOffer");

let container: HTMLDivElement;

beforeEach(() => {
  webAuthn = true;
  window.localStorage.clear();
  startRegistration.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.endsWith("/register/begin")) {
        return Response.json({ options: { challenge: "challenge" }, challengeToken: "token" });
      }
      return Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        deviceName: null,
        aaguid: null,
        lastUsedAt: null,
        createdAt: "2026-10-16T00:00:00.000Z",
      });
    }),
  );
});

afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

function button(name: string): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)!;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("is due only after an emailed sign-in on a device that supports passkeys", () => {
  expect(passkeyOfferDue(true)).toBe(true);
  expect(passkeyOfferDue(false)).toBe(false);
  webAuthn = false;
  expect(passkeyOfferDue(true)).toBe(false);
});

it("creates a passkey and finishes", async () => {
  const onDone = vi.fn();
  startRegistration.mockResolvedValue({ id: "credential" });
  await act(() => render(<PasskeyOffer onDone={onDone} />, container));
  await click(button("Create a passkey"));
  expect(startRegistration).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledOnce();
});

it("stays open with the reason when creation is declined", async () => {
  const onDone = vi.fn();
  startRegistration.mockRejectedValue(new Error("", { cause: new DOMException("", "NotAllowedError") }));
  await act(() => render(<PasskeyOffer onDone={onDone} />, container));
  await click(button("Create a passkey"));
  expect(onDone).not.toHaveBeenCalled();
  expect(container.textContent).toContain("canceled or declined");
});

it("asks again next time after continuing without one", async () => {
  const onDone = vi.fn();
  await act(() => render(<PasskeyOffer onDone={onDone} />, container));
  await click(button("Continue without a passkey"));
  expect(onDone).toHaveBeenCalledOnce();
  expect(passkeyOfferDue(true)).toBe(true);
});

it("stops asking on this device when the box is ticked", async () => {
  const onDone = vi.fn();
  await act(() => render(<PasskeyOffer onDone={onDone} />, container));
  const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => {
    box.checked = true;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Continue without a passkey"));
  expect(onDone).toHaveBeenCalledOnce();
  expect(passkeyOfferDue(true)).toBe(false);
});
