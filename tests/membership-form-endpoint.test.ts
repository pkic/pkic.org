import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestPost } from "../functions/api/v1/forms";
import { createContext, createTestRateLimiter } from "./helpers/context";
import type { Env } from "../functions/_lib/types";

const originalFetch = globalThis.fetch;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    GITHUB_TOKEN: "test-github-token",
    ...overrides,
  };
}

const VALID_FIELDS = {
  Subject: "Join membership",
  Organization: "Acme Inc",
  "First Name": "Alice",
  "Last Name": "Example",
  // Public domain so a valid submission never needs the duplicate-domain
  // search calls — only the issue-creation POST that the fetch mock stubs.
  Email: "alice@gmail.com",
};

function makeFormRequest(url: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("POST /api/v1/forms", () => {
  // ── Origin/Referer guard ──────────────────────────────────────────────────

  it("rejects requests with neither a Referer nor an Origin header", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS);
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects an untrusted origin", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://evil.example.com/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(400);
  });

  it("accepts a *.pkic.pages.dev preview origin", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://abc123.pkic.pages.dev/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://abc123.pkic.pages.dev/join/?status=success");
  });

  it("accepts a *.pkic.workers.dev preview origin", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://8f547e2a-pkic-org.pkic.workers.dev/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
  });

  it("rejects a preview-domain lookalike served over http", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "http://abc123.pkic.pages.dev/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(400);
  });

  it("accepts localhost origins when the app itself resolves to localhost (local dev)", async () => {
    const env = makeEnv(); // no APP_BASE_URL configured
    const request = makeFormRequest("http://localhost:8788/api/v1/forms", VALID_FIELDS, {
      referer: "http://localhost:1313/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:1313/join/?status=success");
  });

  it("rejects a spoofed localhost Referer/Origin in production", async () => {
    const env = makeEnv({ APP_BASE_URL: "https://pkic.org" });
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "http://localhost:8788/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(400);
  });

  // ── Redirect target ───────────────────────────────────────────────────────

  it("redirects to the Referer with ?status=success on a valid submission", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://pkic.org/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?status=success");
  });

  it("redirects to the origin root with ?status=success when Referer is missing but Origin is trusted", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, { origin: "https://pkic.org" });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/?status=success");
  });

  it("preserves existing query params on the referer when redirecting", async () => {
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://pkic.org/join/?ref=newsletter",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?ref=newsletter&status=success");
  });

  // ── Content type ──────────────────────────────────────────────────────────

  it("redirects with ?status=error for a non-form-encoded content type", async () => {
    const env = makeEnv();
    const request = new Request("https://pkic.org/api/v1/forms", {
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://pkic.org/join/" },
      body: JSON.stringify(VALID_FIELDS),
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?status=error");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ── Underlying submission outcome ────────────────────────────────────────

  it("redirects with ?status=error when the submission fails validation", async () => {
    const env = makeEnv();
    const request = makeFormRequest(
      "https://pkic.org/api/v1/forms",
      { ...VALID_FIELDS, Email: "" },
      {
        referer: "https://pkic.org/join/",
      },
    );
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?status=error");
  });

  it("redirects with ?status=error when GitHub issue creation fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const env = makeEnv();
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://pkic.org/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?status=error");
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  it("blocks the submission when the IP rate limiter denies the request", async () => {
    const env = makeEnv({ IP_RATE_LIMITER: createTestRateLimiter(0) });
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://pkic.org/join/",
      "cf-connecting-ip": "1.2.3.4",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?status=error");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("proceeds with the submission when the rate limiter binding is not configured", async () => {
    const env = makeEnv(); // IP_RATE_LIMITER left undefined
    const request = makeFormRequest("https://pkic.org/api/v1/forms", VALID_FIELDS, {
      referer: "https://pkic.org/join/",
    });
    const response = await onRequestPost(createContext(env, request, {}));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://pkic.org/join/?status=success");
  });
});
