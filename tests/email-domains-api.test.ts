import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { emailDomainResponseSchema, emailDomainUrl } from "../assets/shared/schemas/email-domains";
import { callApi } from "./helpers/app";
import { createTestRateLimiter } from "./helpers/context";

function withLimit(limit: number): typeof env {
  return { ...env, IP_RATE_LIMITER: createTestRateLimiter(limit) } as typeof env;
}

function lookup(testEnv: typeof env, path: string): Promise<Response> {
  return callApi(testEnv, path, { method: "GET", headers: { "cf-connecting-ip": "192.0.2.40" } });
}

describe("GET /api/v1/email/domains/:domain", () => {
  it("answers anyone with the kind of mailbox a domain is, against the Worker's lists", async () => {
    const testEnv = withLimit(100);
    const kindOf = async (domain: string) => {
      const response = await lookup(testEnv, emailDomainUrl(domain));
      expect(response.status, await response.clone().text()).toBe(200);
      return emailDomainResponseSchema.parse(await response.json());
    };
    expect(await kindOf("ziggo.nl")).toEqual({ domain: "ziggo.nl", kind: "free" });
    expect(await kindOf("mail.yahoo.co.uk")).toEqual({ domain: "mail.yahoo.co.uk", kind: "free" });
    expect(await kindOf("mailinator.com")).toEqual({ domain: "mailinator.com", kind: "disposable" });
    expect(await kindOf("Mail.IBM.com")).toEqual({ domain: "mail.ibm.com", kind: "work" });
  });

  it("refuses something that is not a domain", async () => {
    expect((await lookup(withLimit(100), "/api/v1/email/domains/not_a_domain")).status).toBe(400);
  });

  it("limits how often one network may ask", async () => {
    const testEnv = withLimit(1);
    expect((await lookup(testEnv, emailDomainUrl("ziggo.nl"))).status).toBe(200);
    expect((await lookup(testEnv, emailDomainUrl("ziggo.nl"))).status).toBe(429);
  });
});
