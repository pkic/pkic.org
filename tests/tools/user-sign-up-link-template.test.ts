import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";
import { DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES } from "../../scripts/lib/transactional-email-default-templates.mjs";

const template = DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES.find((item) => item.key === "user_sign_up_link")!;
const link = {
  email: "ada@organization.example",
  magicLinkUrl: "https://app.test/portal/#/verify?token=x",
  expiresInMinutes: 15,
};

describe("the email that starts an account", () => {
  it.each([
    [
      { registration: true, eventName: "PQC Conference" },
      "Confirm your email to register for PQC Conference",
      "your registration",
    ],
    [
      { proposal: true, eventName: "PQC Conference" },
      "Confirm your email to submit a proposal for PQC Conference",
      "your proposal",
    ],
    [{ join: true }, "Confirm your email to join the PKI Consortium", "your membership application"],
    [{}, "Confirm your email for the PKI Consortium", "the portal"],
  ])("names what the person came for (%o)", (purpose, subject, destination) => {
    const data = { ...link, ...purpose };
    expect(compileSimpleTemplate(template.subjectTemplate, data, "text")).toBe(subject);
    const body = compileSimpleTemplate(template.content, data, "markdown");
    expect(body).toContain("**ada@organization.example**");
    expect(body).toContain(`takes you straight back to ${destination}`);
    // Sent alike to an address with or without an account, it never says which one this is.
    expect(body).toContain("creates your PKI Consortium account, or signs you in if you already have one");
    expect(body).not.toContain("sign-in link was requested");
  });
});
