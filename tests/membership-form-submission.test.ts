import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  submitMembershipForm,
  MembershipFormValidationError,
} from "../functions/_lib/services/membership-form-submission";
import type { Env } from "../functions/_lib/types";

const originalFetch = globalThis.fetch;

const VALID_FIELDS = {
  Subject: "Join membership",
  Organization: "Acme Inc",
  "First Name": "Alice",
  "Last Name": "Example",
  // Non-public domain so the duplicate-domain check runs.
  Email: "alice@acme.com",
};

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return formData;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    GITHUB_TOKEN: "test-github-token",
    ...overrides,
  };
}

type FetchCall = { url: string; init?: RequestInit };

/**
 * Dispatches to a handler based on which GitHub endpoint the URL matches.
 * Every call (including the fixed URL, e.g. issue creation) is recorded so
 * tests can assert on call count/order and inspect request bodies/query
 * strings.
 */
function makeFetchMock(handlers: {
  issueCreate?: () => Response | Promise<Response>;
  codeSearch?: () => Response | Promise<Response>;
  issueSearch?: () => Response | Promise<Response>;
}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });

    if (url === "https://api.github.com/repos/pkic/members/issues") {
      return handlers.issueCreate ? handlers.issueCreate() : new Response(null, { status: 201 });
    }
    if (url.startsWith("https://api.github.com/search/code")) {
      return handlers.codeSearch ? handlers.codeSearch() : new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.startsWith("https://api.github.com/search/issues")) {
      return handlers.issueSearch
        ? handlers.issueSearch()
        : new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    throw new Error("Unexpected fetch URL in test: " + url);
  });
  return { fn, calls };
}

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("submitMembershipForm", () => {
  // ── Validation ────────────────────────────────────────────────────────────

  it("throws when GITHUB_TOKEN is not configured", async () => {
    const env = makeEnv({ GITHUB_TOKEN: undefined });
    await expect(submitMembershipForm(makeFormData(VALID_FIELDS), env)).rejects.toThrow(
      "GITHUB_TOKEN is not configured",
    );
  });

  it("throws MembershipFormValidationError when Subject is missing", async () => {
    const env = makeEnv();
    await expect(submitMembershipForm(makeFormData({ ...VALID_FIELDS, Subject: "" }), env)).rejects.toBeInstanceOf(
      MembershipFormValidationError,
    );
  });

  it("throws MembershipFormValidationError when both First Name and Last Name are missing", async () => {
    const env = makeEnv();
    await expect(
      submitMembershipForm(makeFormData({ ...VALID_FIELDS, "First Name": "", "Last Name": "" }), env),
    ).rejects.toBeInstanceOf(MembershipFormValidationError);
  });

  it("throws MembershipFormValidationError when Email is missing", async () => {
    const env = makeEnv();
    await expect(submitMembershipForm(makeFormData({ ...VALID_FIELDS, Email: "" }), env)).rejects.toBeInstanceOf(
      MembershipFormValidationError,
    );
  });

  it("does not require Organization if a name is present", async () => {
    const { fn } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();
    await expect(
      submitMembershipForm(makeFormData({ ...VALID_FIELDS, Organization: "", Email: "alice@gmail.com" }), env),
    ).resolves.toBeUndefined();
  });

  // ── Happy path / issue creation ──────────────────────────────────────────

  it("creates a GitHub issue with the expected title, labels, and body", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData({ ...VALID_FIELDS, Email: "alice@gmail.com" }), env);

    // Public domain (gmail.com) skips the duplicate check entirely.
    expect(calls).toHaveLength(1);
    const issueCall = calls[0];
    expect(issueCall.url).toBe("https://api.github.com/repos/pkic/members/issues");
    expect((issueCall.init!.headers as Record<string, string>).Authorization).toBe("Bearer test-github-token");

    const body = JSON.parse(issueCall.init!.body as string) as { title: string; labels: string[]; body: string };
    expect(body.title).toBe("Join membership from Acme Inc");
    expect(body.labels).toEqual(["Join membership"]);
    expect(body.body).toContain("**Organization**: Acme Inc");
    expect(body.body).toContain("**Email**: alice@gmail.com");
    expect(body.body).not.toContain("**Subject**");
  });

  it("throws when GitHub issue creation fails", async () => {
    const { fn } = makeFetchMock({ issueCreate: () => new Response(null, { status: 500 }) });
    globalThis.fetch = fn;
    const env = makeEnv();

    await expect(
      submitMembershipForm(makeFormData({ ...VALID_FIELDS, Email: "alice@gmail.com" }), env),
    ).rejects.toThrow("GitHub issue creation failed with status 500");
  });

  it("skips the duplicate-domain check entirely for sponsor-interest submissions", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData({ ...VALID_FIELDS, Subject: "Sponsor interest" }), env);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/pkic/members/issues");
  });

  it("skips the duplicate-domain check for public email domains", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData({ ...VALID_FIELDS, Email: "alice@yahoo.com" }), env);

    expect(calls).toHaveLength(1);
  });

  // ── Duplicate-domain check: YAML search ──────────────────────────────────

  it("queries the YAML code search with the expected query string", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const codeSearchCall = calls.find((c) => c.url.startsWith("https://api.github.com/search/code"));
    expect(codeSearchCall).toBeDefined();
    const q = new URL(codeSearchCall!.url).searchParams.get("q");
    expect(q).toBe('repo:pkic/pkic.org language:YAML "- acme.com"');
  });

  it("adds the duplicate-review label and skips the issue search when the YAML search finds a match", async () => {
    const { fn, calls } = makeFetchMock({
      codeSearch: () => new Response(JSON.stringify({ items: [{ name: "acme.yaml" }] }), { status: 200 }),
    });
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const codeSearchCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/search/code"));
    const issueSearchCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/search/issues"));
    expect(codeSearchCalls).toHaveLength(1);
    expect(issueSearchCalls).toHaveLength(0);

    const issueCreateCall = calls.find((c) => c.url === "https://api.github.com/repos/pkic/members/issues")!;
    const body = JSON.parse(issueCreateCall.init!.body as string) as { labels: string[] };
    expect(body.labels).toEqual(["Join membership", "Review & Add to Mailing Lists"]);
  });

  it("falls back to the issue search when the YAML search finds nothing", async () => {
    const { fn, calls } = makeFetchMock({
      codeSearch: () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      issueSearch: () =>
        new Response(
          JSON.stringify({ items: [{ number: 1, state: "open", body: "contact: person@acme.com", labels: [] }] }),
          { status: 200 },
        ),
    });
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const issueSearchCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/search/issues"));
    expect(issueSearchCalls).toHaveLength(1);

    const issueCreateCall = calls.find((c) => c.url === "https://api.github.com/repos/pkic/members/issues")!;
    const body = JSON.parse(issueCreateCall.init!.body as string) as { labels: string[] };
    expect(body.labels).toContain("Review & Add to Mailing Lists");
  });

  it("does not add the duplicate-review label when neither search finds a match", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const issueCreateCall = calls.find((c) => c.url === "https://api.github.com/repos/pkic/members/issues")!;
    const body = JSON.parse(issueCreateCall.init!.body as string) as { labels: string[] };
    expect(body.labels).toEqual(["Join membership"]);
  });

  it("falls back to the issue search when the YAML code search response is not ok", async () => {
    const { fn, calls } = makeFetchMock({ codeSearch: () => new Response(null, { status: 403 }) });
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const issueSearchCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/search/issues"));
    expect(issueSearchCalls).toHaveLength(1);
  });

  it("falls back to the issue search when the YAML code search throws", async () => {
    const { fn, calls } = makeFetchMock({
      codeSearch: () => {
        throw new Error("network down");
      },
    });
    globalThis.fetch = fn;
    const env = makeEnv();

    await expect(submitMembershipForm(makeFormData(VALID_FIELDS), env)).resolves.toBeUndefined();

    const issueSearchCalls = calls.filter((c) => c.url.startsWith("https://api.github.com/search/issues"));
    expect(issueSearchCalls).toHaveLength(1);
  });

  // ── Sanitization ──────────────────────────────────────────────────────────

  it("strips quote and backslash characters from the domain before building the search query", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData({ ...VALID_FIELDS, Email: 'alice@a"c\\me.com' }), env);

    const codeSearchCall = calls.find((c) => c.url.startsWith("https://api.github.com/search/code"))!;
    const q = new URL(codeSearchCall.url).searchParams.get("q");
    expect(q).toBe('repo:pkic/pkic.org language:YAML "- acme.com"');
  });

  it("skips both domain searches entirely when sanitization empties the domain", async () => {
    const { fn, calls } = makeFetchMock({});
    globalThis.fetch = fn;
    const env = makeEnv();

    // Domain is a single `"` character, which sanitizeForSearchQuery strips
    // down to an empty string.
    await submitMembershipForm(makeFormData({ ...VALID_FIELDS, Email: 'alice@"' }), env);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/pkic/members/issues");
    const body = JSON.parse(calls[0].init!.body as string) as { labels: string[] };
    expect(body.labels).toEqual(["Join membership"]);
  });

  // ── Issue-search filtering ────────────────────────────────────────────────

  it("ignores issues carrying an excluded label", async () => {
    const { fn, calls } = makeFetchMock({
      codeSearch: () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      issueSearch: () =>
        new Response(
          JSON.stringify({
            items: [{ number: 1, state: "open", body: "contact: person@acme.com", labels: [{ name: "Rejected" }] }],
          }),
          { status: 200 },
        ),
    });
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const issueCreateCall = calls.find((c) => c.url === "https://api.github.com/repos/pkic/members/issues")!;
    const body = JSON.parse(issueCreateCall.init!.body as string) as { labels: string[] };
    expect(body.labels).toEqual(["Join membership"]);
  });

  it("does not false-positive when the issue body mentions a superset domain", async () => {
    const { fn, calls } = makeFetchMock({
      codeSearch: () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      issueSearch: () =>
        new Response(
          JSON.stringify({ items: [{ number: 1, state: "open", body: "contact: person@acme.com.au", labels: [] }] }),
          { status: 200 },
        ),
    });
    globalThis.fetch = fn;
    const env = makeEnv();

    await submitMembershipForm(makeFormData(VALID_FIELDS), env);

    const issueCreateCall = calls.find((c) => c.url === "https://api.github.com/repos/pkic/members/issues")!;
    const body = JSON.parse(issueCreateCall.init!.body as string) as { labels: string[] };
    expect(body.labels).toEqual(["Join membership"]);
  });
});
