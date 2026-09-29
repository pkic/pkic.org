// @vitest-environment jsdom
/**
 * The silent passkey upgrade attempted after an emailed sign-in.
 *
 * This is WebAuthn's conditional create, and the whole point of it is that the
 * platform decides. So what is asserted here is restraint: it does not run
 * where the browser cannot do it, it swallows the refusals the platform is
 * expected to give, and it never surfaces any of that to a reader who asked
 * for none of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startRegistration = vi.fn<(options: { useAutoRegister?: boolean }) => Promise<unknown>>();
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: (options: { useAutoRegister?: boolean }) => startRegistration(options),
}));

const { attemptAutomaticPasskeyUpgrade } = await import("../../assets/ts/components/passkey-enrollment");

function capabilities(conditionalCreate: boolean | undefined): void {
  vi.stubGlobal("PublicKeyCredential", {
    getClientCapabilities: async () => ({ conditionalCreate }),
  });
}

/** Records every request, answering the begin and complete calls. */
function stubFetch(): string[] {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://x",
      );
      paths.push(url.pathname);
      if (url.pathname.endsWith("/register/begin")) {
        return Response.json({ success: true, challengeToken: "token", options: { challenge: "c" } });
      }
      return Response.json({ success: true, id: "p1", deviceName: null, createdAt: "", lastUsedAt: null });
    }),
  );
  return paths;
}

beforeEach(() => {
  startRegistration.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("automatic passkey upgrade", () => {
  it("asks the platform to make a passkey without prompting the reader", async () => {
    capabilities(true);
    const paths = stubFetch();
    startRegistration.mockResolvedValue({ id: "credential" });

    await attemptAutomaticPasskeyUpgrade();

    // `useAutoRegister` is what makes this conditional create rather than a
    // modal ceremony the reader never asked for.
    expect(startRegistration).toHaveBeenCalledWith(expect.objectContaining({ useAutoRegister: true }));
    expect(paths).toEqual(["/api/v1/auth/passkeys/register/begin", "/api/v1/auth/passkeys/register/complete"]);
  });

  it("does nothing at all where the browser cannot create one silently", async () => {
    capabilities(false);
    const paths = stubFetch();

    await attemptAutomaticPasskeyUpgrade();

    // Not even the begin call: a session is not spent asking for options that
    // cannot be used.
    expect(paths).toEqual([]);
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("does nothing on a browser without the capability API", async () => {
    vi.stubGlobal("PublicKeyCredential", {});
    const paths = stubFetch();

    await attemptAutomaticPasskeyUpgrade();

    expect(paths).toEqual([]);
  });

  it("accepts the platform's refusal in silence", async () => {
    capabilities(true);
    const paths = stubFetch();

    for (const name of ["NotAllowedError", "InvalidStateError", "AbortError"]) {
      const refusal = new Error("declined");
      refusal.name = name;
      startRegistration.mockRejectedValueOnce(refusal);

      // Resolves rather than rejecting: a platform that declines has already
      // shown the reader nothing, so there is nothing to report.
      await expect(attemptAutomaticPasskeyUpgrade()).resolves.toBeUndefined();
    }

    // Each attempt asked, and none of them completed.
    expect(paths.filter((path) => path.endsWith("/register/complete"))).toEqual([]);
  });

  it("keeps its own failures away from the reader too", async () => {
    capabilities(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "FORBIDDEN", message: "no" } }, { status: 403 })),
    );

    await expect(attemptAutomaticPasskeyUpgrade()).resolves.toBeUndefined();
    expect(startRegistration).not.toHaveBeenCalled();
  });
});
