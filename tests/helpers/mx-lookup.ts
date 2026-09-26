import { vi } from "vitest";

/**
 * Keeps registration tests deterministic when they use realistic email domains.
 * MX-specific tests should install their own response instead.
 */
export function stubSuccessfulMxLookup(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://1.1.1.1/dns-query?")) {
        throw new Error(`Unexpected external request in registration test: ${url}`);
      }
      return Response.json({ Status: 0, Answer: [{ type: 15 }] });
    }),
  );
}
