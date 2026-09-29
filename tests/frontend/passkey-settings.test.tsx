import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { passkeyRegisterCompleteSchema } from "../../assets/shared/schemas/passkeys";

const startRegistration = vi.fn();
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: (...args: unknown[]) => startRegistration(...args),
}));
const { PasskeySettings } = await import("../../assets/ts/components/passkey-settings");

let container: HTMLDivElement;
let completed: unknown[];

beforeEach(() => {
  startRegistration.mockReset();
  completed = [];
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/register/begin")) {
        return Response.json({ options: { challenge: "challenge" }, challengeToken: "token" });
      }
      if (input.endsWith("/register/complete")) {
        completed.push(passkeyRegisterCompleteSchema.parse(JSON.parse(String(init?.body))));
        return Response.json({
          id: "11111111-1111-4111-8111-111111111111",
          deviceName: null,
          aaguid: null,
          lastUsedAt: null,
          createdAt: "2026-09-29T00:00:00.000Z",
        });
      }
      return Response.json({ passkeys: [] });
    }),
  );
});

afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

async function submit(): Promise<void> {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it.each([
  [new Error("", { cause: new DOMException("", "NotAllowedError") }), "Unlock your password manager"],
  [new DOMException("", "InvalidStateError"), "already has a passkey"],
  [new Error(""), "The passkey could not be added"],
  [undefined, "The passkey could not be added"],
  [new Error("The registration service is unavailable"), "The registration service is unavailable"],
])("keeps a provider failure visible and allows a successful retry (%s)", async (reason, message) => {
  startRegistration.mockRejectedValueOnce(reason);
  await act(async () => render(<PasskeySettings toastTargetId="test-toasts" />, container));
  await submit();

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
  expect(container.querySelector('button[type="submit"]')?.textContent).toBe("Add a passkey");
  expect(completed).toHaveLength(0);

  startRegistration.mockResolvedValueOnce({
    id: "credential",
    rawId: "credential",
    type: "public-key",
    clientExtensionResults: {},
    response: { clientDataJSON: "client", attestationObject: "attestation" },
  });
  await submit();

  expect(completed).toHaveLength(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
