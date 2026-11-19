import { describe, expect, it } from "vitest";
import { compileSimpleTemplate } from "../../functions/_lib/email/render";
import { compileSeededBody } from "./helpers/seeded-email-partials";
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
    const body = compileSeededBody(template.content, data);
    expect(body).toContain("**ada@organization.example**");
    expect(body).toContain(`takes you straight back to ${destination}`);
    expect(body).toContain("The link sets up your PKI Consortium account");
    expect(body).toContain("Confirm my email");
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
    const body = compileSeededBody(found.content, data);
    expect(body).toContain("You already have a PKI Consortium account with **ada@organization.example**");
    expect(body).toContain(`Sign in to continue ${destination}.`);
    expect(body).not.toContain("Your registration details");
    expect(body).toContain(link.magicLinkUrl);
  });

  it("tells an account that is already registered so, shows the registration and leads to it", () => {
    const data = {
      ...link,
      registration: true,
      alreadyRegistered: true,
      eventName: "PQC Conference",
      firstName: "Ada",
      lastName: "Lovelace",
      dayAttendance: [{ dayLabel: "Day 1", attendanceLabel: "In person", statusLabel: "Confirmed" }],
    };
    expect(compileSimpleTemplate(found.subjectTemplate, data, "text")).toBe(
      "You're already registered for PQC Conference",
    );
    const body = compileSeededBody(found.content, data);
    expect(body).toContain("Dear Ada,");
    expect(body).toContain("you're already registered for **PQC Conference**, so there's nothing more to do");
    expect(body).toContain("View or change my registration");
    expect(body).toContain("## Your registration details");
    expect(body).toContain("**Name:** Ada Lovelace");
    expect(body).toContain("**Day 1:** In person — Confirmed");
    expect(body).not.toContain("Sign in and continue");
    expect(body).toContain(link.magicLinkUrl);
  });
});

describe("the email for a sign-in request that sends no link", () => {
  it("offers an address without an account the way to start one", () => {
    const data = { noAccount: true, email: "ada@organization.example", startUrl: "https://app.test/portal/" };
    expect(compileSimpleTemplate(help.subjectTemplate, data, "text")).toBe(
      "We couldn't find a PKI Consortium account for this address",
    );
    const body = compileSeededBody(help.content, data);
    expect(body).toContain("no PKI Consortium account uses this address");
    expect(body).toContain("Create an account");
    expect(body).toContain('href="https://app.test/portal/"');
  });

  it("sends a proved address its account cannot sign in with to the secretariat", () => {
    const data = { email: "ada@organization.example", contactEmail: "contact@pkic.org" };
    expect(compileSimpleTemplate(help.subjectTemplate, data, "text")).toBe("We couldn't send you a sign-in link");
    const body = compileSeededBody(help.content, data);
    expect(body).toContain("this address can't be used to sign in to its account");
    expect(body).toContain("mailto:contact@pkic.org");
    expect(body).not.toContain("Create an account");
  });
});
