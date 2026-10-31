// @vitest-environment jsdom
import { render } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinFlow } from "../../assets/ts/site/JoinFlow";
import {
  JoinSignedInApplicant,
  joinRefusalFor,
  type SignedInApplicant,
} from "../../assets/ts/member-flows/join-signed-in";
import { sessionActingIdentitySchema } from "../../assets/shared/session-acting-identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import {
  memberApplicationCreateAsIdentitySchemaForCategory,
  memberApplicationFormResponseSchema,
} from "../../assets/shared/schemas/member-applications";
import { membershipApplicationFields } from "../../assets/shared/schemas/membership-application-form";

const USER_ID = "00000000-0000-4000-8000-000000000061";
const PERSONAL_ID = "00000000-0000-4000-8000-000000000062";
const REPRESENTATION_ID = "00000000-0000-4000-8000-000000000063";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000064";

const personal = sessionActingIdentitySchema.parse({
  id: PERSONAL_ID,
  organizationId: null,
  organizationName: null,
  jobTitle: null,
});
const representation = sessionActingIdentitySchema.parse({
  id: REPRESENTATION_ID,
  organizationId: ORGANIZATION_ID,
  organizationName: "Example Corp",
  jobTitle: "Security architect",
});
const memberRepresentation = { ...representation, membershipCategory: "A", membershipLabel: "Certification authority" };
const individualMember = { ...personal, membershipCategory: "H6", membershipLabel: "Independent consultant" };

function field(key: string, fieldType: "textarea" | "url" | "text" = "textarea") {
  return {
    id: crypto.randomUUID(),
    key,
    label: `Configured ${key}`,
    fieldType,
    required: true,
    options: null,
    optionSource: null,
    validation: null,
    sortOrder: 1,
    updatedAt: "2026-08-30T00:00:00.000Z",
    archivedAt: null,
  };
}

const definition = memberApplicationFormResponseSchema.parse({
  categories: [
    {
      code: "A",
      label: "Certification authority",
      description: null,
      displayOrder: 10,
      isIndividual: false,
      requiresUniversityEmail: false,
      isVoting: true,
      active: true,
      workflowVersionId: null,
      eligibleWorkingGroupIds: [],
      fee: null,
      revision: 0,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
    {
      code: "H6",
      label: "Independent consultant",
      description: null,
      displayOrder: 60,
      isIndividual: true,
      requiresUniversityEmail: false,
      isVoting: false,
      active: true,
      workflowVersionId: null,
      eligibleWorkingGroupIds: [],
      fee: null,
      revision: 0,
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
  ],
  form: {
    id: "00000000-0000-4000-8000-000000000065",
    key: "membership-application",
    title: "Membership application",
    description: null,
    fields: [
      field("reason"),
      field("job_title", "text"),
      field("linkedin", "url"),
      field("about_yourself"),
      field("about_organization"),
    ],
  },
});

function applicant(identities: SignedInApplicant["identities"], preferred = identities[0]): SignedInApplicant {
  return { userId: USER_ID, name: "Ada Lovelace", email: "ada@example-corp.test", identities, preferred };
}

let host: HTMLElement | null = null;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.resetModules();
  window.location.hash = "";
});

function mount(person: SignedInApplicant, onIdentityChange = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  render(<JoinSignedInApplicant applicant={person} onIdentityChange={onIdentityChange} />, host);
  return host;
}

describe("signed-in membership application", () => {
  it("foresees the refusals the server makes, and none for an identity that may apply", () => {
    expect(joinRefusalFor(memberRepresentation, [personal, memberRepresentation])).toEqual({
      kind: "organization_member",
      organizationName: "Example Corp",
      href: `/portal/#/organizations/${ORGANIZATION_ID}`,
    });
    expect(joinRefusalFor(individualMember, [individualMember])).toMatchObject({ kind: "individual_member" });
    expect(joinRefusalFor(personal, [personal, representation])).toEqual({
      kind: "representing",
      organizationName: "Example Corp",
    });
    expect(joinRefusalFor(personal, [personal])).toBeNull();
    // Representing an organization never stops an application for that organization.
    expect(joinRefusalFor(representation, [personal, representation])).toBeNull();
  });

  it("shows the applicant's name, email and representation instead of fields to type them", () => {
    const view = mount(applicant([representation, personal]));
    const terms = Array.from(view.querySelectorAll("dt")).map((term) => term.textContent);
    expect(terms).toEqual(["Name", "Email", "Representation"]);
    expect(view.textContent).toContain("Ada Lovelace");
    expect(view.textContent).toContain("ada@example-corp.test");
    expect(view.textContent).toContain("Example Corp");
    expect(view.querySelector('button[aria-label="Change representation"]')).not.toBeNull();
    expect(view.querySelector("[data-join-refusal]")).toBeNull();
  });

  it("explains an individual application while representing an organization", () => {
    const view = mount(applicant([personal, representation]));
    const refusal = view.querySelector("[data-join-refusal='representing']");
    expect(refusal?.querySelector("h2")?.textContent).toBe("Apply for your organization instead");
    expect(refusal?.textContent).toContain("You represent Example Corp.");
    expect(refusal?.textContent).toContain("End the representation first");
  });

  it("shows an existing member their membership with a link to manage it", () => {
    const organization = mount(applicant([memberRepresentation]));
    const link = organization.querySelector<HTMLAnchorElement>("[data-join-refusal='organization_member'] a");
    expect(link?.getAttribute("href")).toBe(`/portal/#/organizations/${ORGANIZATION_ID}`);
    expect(link?.textContent).toBe("Manage membership");
    render(null, organization);

    const individual = mount(applicant([individualMember]));
    expect(individual.querySelector("[data-join-refusal='individual_member'] h2")?.textContent).toBe(
      "You are already a member",
    );
    expect(individual.querySelector("[data-join-refusal='individual_member'] a")?.getAttribute("href")).toBe(
      "/portal/#/home",
    );
  });

  it("sends only the identity, category and remaining answers through the shared contract", () => {
    const category = definition.categories[0];
    const fields = definition.form?.fields ?? [];
    const asked = membershipApplicationFields(fields, category, { fromIdentity: true }).map(({ key }) => key);
    expect(asked).not.toContain("job_title");
    expect(asked).not.toContain("linkedin");
    expect(asked).not.toContain("about_yourself");
    const payload = memberApplicationCreateAsIdentitySchemaForCategory(category, fields).parse({
      identityId: REPRESENTATION_ID,
      membershipCategory: "A",
      answers: { reason: "We contribute.", about_organization: "We build PKI." },
    });
    expect(payload).toEqual({
      identityId: REPRESENTATION_ID,
      membershipCategory: "A",
      answers: { reason: "We contribute.", about_organization: "We build PKI." },
    });
  });

  it("replaces the email step and typed details on /join/ for a signed-in person", async () => {
    document.body.innerHTML = renderToString(<JoinFlow documents={[]} />);
    const session = userAuthSessionResponseSchema.parse({
      success: true,
      sessionId: "00000000-0000-4000-8000-000000000066",
      expiresAt: "2099-12-31T23:59:59.000Z",
      idleExpiresAt: "2099-12-31T23:59:59.000Z",
      identity: { id: USER_ID, email: "ada@example-corp.test" },
      actingIdentities: [representation],
      actingIdentityId: REPRESENTATION_ID,
    });
    const profile = myProfileSchema.parse({
      userId: USER_ID,
      identityId: REPRESENTATION_ID,
      emailId: null,
      email: "ada@example-corp.test",
      emailAddresses: [],
      firstName: "Ada",
      lastName: "Lovelace",
      preferredName: null,
      jobTitle: "Security architect",
      biography: "I work on PKI.",
      links: [],
      membershipCategory: null,
      organizationId: ORGANIZATION_ID,
      organizationName: "Example Corp",
      memberSince: null,
      showOnOrgProfile: false,
      headshotUrl: null,
      isOrgContact: false,
      organizationIdentities: null,
      activeIdentities: [],
    });
    const responses: Record<string, unknown> = {
      "/api/v1/auth/session": session,
      "/api/v1/users/current": profile,
      "/api/v1/members/applications/form": definition,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = responses[url];
        return new Response(JSON.stringify(body ?? { error: { code: "NOT_FOUND" } }), {
          status: body ? 200 : 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await import("../../assets/ts/member-flows/join-form");

    const form = document.querySelector<HTMLFormElement>("[data-join-application-form]")!;
    await vi.waitFor(() => expect(form.hidden).toBe(false));
    expect(document.querySelector<HTMLElement>("[data-join-start]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-join-signed-in]")?.textContent).toContain("Example Corp");
    expect(form.querySelector('[name="firstName"]')).toBeNull();
    expect(form.querySelector('[name="organizationName"]')).toBeNull();
    expect(form.querySelector("[data-join-verified-context]")).toBeNull();
    const categories = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="membershipCategory"]'));
    expect(categories.map((input) => input.value)).toEqual(["A"]);
    expect(form.querySelector('[name="custom.about_yourself"]')).toBeNull();
    expect(form.querySelector('[name="custom.about_organization"]')).not.toBeNull();
  });
});
