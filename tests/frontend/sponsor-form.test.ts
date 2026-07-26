// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { normalizeUrl, buildSponsorshipPayload } from "../../assets/ts/member-flows/sponsor-form";

function buildForm(overrides: Partial<Record<string, string>> = {}): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <input name="firstName" value="${overrides.firstName ?? "Dana"}" />
    <input name="lastName" value="${overrides.lastName ?? "Sponsor"}" />
    <input name="email" value="${overrides.email ?? "dana@example.test"}" />
    <input name="organizationName" value="${overrides.organizationName ?? "Example Sponsor Co"}" />
    <input id="organizationWebsite" name="organizationWebsite" value="${overrides.organizationWebsite ?? ""}" />
    <select name="desiredTier">
      <option value="Gold" selected>Gold</option>
    </select>
    <textarea name="comments">${overrides.comments ?? ""}</textarea>
  `;
  document.body.append(form);
  return form;
}

describe("sponsor-form helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves fully-qualified URLs untouched", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("defaults bare domains to https://", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("//example.com")).toBe("https://example.com");
  });

  it("leaves an empty value empty", () => {
    expect(normalizeUrl("  ")).toBe("");
  });

  it("builds the sponsorship inquiry payload", () => {
    const form = buildForm({ organizationWebsite: "example-sponsor.test" });
    const payload = buildSponsorshipPayload(form);
    expect(payload.contactName).toBe("Dana Sponsor");
    expect(payload.contactEmail).toBe("dana@example.test");
    expect(payload.organizationName).toBe("Example Sponsor Co");
    expect(payload.organizationWebsite).toBe("https://example-sponsor.test");
    expect(payload.desiredTier).toBe("Gold");
    expect(payload.comments).toBeUndefined();
  });
});
