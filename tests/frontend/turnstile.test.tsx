// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { requestTurnstileToken } from "../../assets/ts/shared/turnstile";
import { postJson } from "../../assets/ts/shared/api-client";
import { successResponseSchema } from "../../assets/shared/schemas/api-common";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";

const challenge = { siteKey: "test-site", action: "login_email" };
afterEach(() => {
  delete window.turnstile;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
function widget() {
  const remove = vi.fn();
  let options: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
  window.turnstile = {
    render: vi.fn((_container, supplied) => {
      options = supplied;
      return "widget-id";
    }),
    remove,
    reset: vi.fn(),
  };
  return { remove, options: () => options };
}
describe("shared Turnstile challenge", () => {
  it("requires a fresh token, expires it, and cleans up after cancellation", async () => {
    const api = widget();
    let pending: Promise<string>;
    await act(async () => {
      pending = requestTurnstileToken(challenge);
    });
    const refusal = expect(pending!).rejects.toThrow("Verification canceled");
    expect(button("Continue").disabled).toBe(true);
    await act(async () => api.options().callback("fresh"));
    expect(button("Continue").disabled).toBe(false);
    await act(async () => api.options()["expired-callback"]());
    expect(button("Continue").disabled).toBe(true);
    await act(async () => button("Cancel").click());
    await refusal;
    expect(api.remove).toHaveBeenCalledWith("widget-id");
    expect(document.querySelector("dialog")).toBeNull();
  });
  it("retries the unchanged validated body once after the pre-handler refusal", async () => {
    const api = widget();
    const sent: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push({ ...init, headers: new Headers(init.headers) });
        return sent.length === 1
          ? Response.json(
              { error: { code: "TURNSTILE_REQUIRED", message: "Verify", details: challenge } },
              { status: 403 },
            )
          : Response.json({ success: true });
      }),
    );
    let pending: Promise<unknown>;
    await act(async () => {
      pending = postJson("/api/v1/auth/request-link", { email: "reader@example.test" }, successResponseSchema);
    });
    await vi.waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled());
    await act(async () => api.options().callback("fresh"));
    await act(async () => button("Continue").click());
    await expect(pending!).resolves.toEqual({ success: true });
    expect(sent).toHaveLength(2);
    expect(userAuthRequestSchema.parse(JSON.parse(sent[1].body as string)).email).toBe("reader@example.test");
    expect(sent[1].body).toBe(sent[0].body);
    expect(new Headers(sent[0].headers).has("x-turnstile-token")).toBe(false);
    expect(new Headers(sent[1].headers).get("x-turnstile-token")).toBe("fresh");
    expect(api.remove).toHaveBeenCalledOnce();
  });
  it("does not retry invalid tokens or challenge cross-origin requests", async () => {
    widget();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "TURNSTILE_INVALID", message: "Failed" } }, { status: 403 })),
    );
    await expect(
      postJson("/api/v1/auth/request-link", { email: "reader@example.test" }, successResponseSchema),
    ).rejects.toMatchObject({ code: "TURNSTILE_INVALID" });
    expect(window.turnstile?.render).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "TURNSTILE_REQUIRED", message: "Verify", details: challenge } },
          { status: 403 },
        ),
      ),
    );
    await expect(postJson("https://other.example/api", {}, successResponseSchema)).rejects.toMatchObject({
      code: "TURNSTILE_REQUIRED",
    });
    expect(window.turnstile?.render).not.toHaveBeenCalled();
  });
});
