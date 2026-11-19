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

const found = DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES.find((item) => item.key === "user_account_found_link")!;
const help = DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES.find((item) => item.key === "user_sign_in_help")!;

describe("the email for an address that already has an account", () => {
  it.each([
    [
      { registration: true, eventName: "PQC Conference" },
      "Continue your registration for PQC Conference",
      "your registration for **PQC Conference**",
    ],
    [
      { proposal: true, eventName: "PQC Conference" },
      "Continue your proposal for PQC Conference",
      "your proposal for **PQC Conference**",
    ],
    [{ join: true }, "Continue your membership application", "your membership application"],
    [{}, "Sign in to the PKI Consortium", "to the portal"],
  ])("says the account was found and continues what the person came for (%o)", (purpose, subject, destination) => {
    const data = { ...link, ...purpose };
    expect(compileSimpleTemplate(found.subjectTemplate, data, "text")).toBe(subject);
    const body = compileSimpleTemplate(found.content, data, "markdown");
    expect(body).toContain("You already have a PKI Consortium account with **ada@organization.example**");
    expect(body).toContain(`Sign in with this link to continue ${destination}.`);
    expect(body).toContain(link.magicLinkUrl);
  });
});

describe("the email for a sign-in request that sends no link", () => {
  it("offers an address without an account the way to start one", () => {
    const data = { noAccount: true, email: "ada@organization.example", startUrl: "https://app.test/portal/" };
    expect(compileSimpleTemplate(help.subjectTemplate, data, "text")).toBe(
      "No PKI Consortium account uses this address",
    );
    const body = compileSimpleTemplate(help.content, data, "markdown");
    expect(body).toContain("no PKI Consortium account signs in with this address");
    expect(body).toContain('href="https://app.test/portal/"');
  });

  it("sends a proved address its account cannot sign in with to the secretariat", () => {
    const data = { email: "ada@organization.example", contactEmail: "contact@pkic.org" };
    expect(compileSimpleTemplate(help.subjectTemplate, data, "text")).toBe(
      "We could not send a PKI Consortium sign-in link",
    );
    const body = compileSimpleTemplate(help.content, data, "markdown");
    expect(body).toContain("cannot sign in with it");
    expect(body).toContain("mailto:contact@pkic.org");
    expect(body).not.toContain("Start an account");
  });
});
