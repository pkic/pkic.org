// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FIRST_COPY, WORK_EMAIL_STEER } from "../../assets/shared/email-first-copy";
import { memberJoinVerifySchema } from "../../assets/shared/schemas/member-join";
import { openJoinPage } from "./helpers/join-page";
import {
  JoinSignedInApplicant,
  joinRefusalFor,
  type SignedInApplicant,
} from "../../assets/ts/member-flows/join-signed-in";
import { sessionActingIdentitySchema } from "../../assets/shared/session-acting-identity";
import {
  memberApplicationCreateAsIdentitySchemaForCategory,
  memberApplicationFormResponseSchema,
} from "../../assets/shared/schemas/member-applications";
import { membershipApplicationFields } from "../../assets/shared/schemas/membership-application-form";
import { myProfileSchema, myProfileUpdateSchema } from "../../assets/shared/schemas/me";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";
import { buttonNamed, controlFor } from "./helpers/labeled-control";

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
  return {
    userId: USER_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    name: "Ada Lovelace",
    email: "ada@example-corp.test",
    identities,
    preferred,
  };
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
  sessionStorage.clear();
});

function mount(person: SignedInApplicant, onChange = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  render(<JoinSignedInApplicant applicant={person} onChange={onChange} />, host);
  return host;
}

function choosePath(path: "organization" | "individual"): Promise<void> {
  return act(async () => {
    const card = document.querySelector<HTMLInputElement>(`input[name="joinPath"][value="${path}"]`)!;
    card.checked = true;
    card.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

  it("lets a new account add the name the application needs, on the person's own profile", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        patches.push(body);
        return Response.json(myProfileSchema.parse({ ...portalProfileFixture(portalSessionFixture({})), ...body }));
      }),
    );
    const onNamesSaved = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    const unnamed = { ...applicant([personal]), firstName: "", lastName: "", name: "" };
    render(<JoinSignedInApplicant applicant={unnamed} onChange={vi.fn()} onNamesSaved={onNamesSaved} />, host);
    expect(host.textContent).toContain("Add your name");

    await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Edit personal details"]')!.click());
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    for (const [label, text] of [
      ["First name", "Ada"],
      ["Last name", "Lovelace"],
    ] as const)
      await act(() => {
        const control = controlFor(dialog, label);
        control.value = text;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await act(async () => buttonNamed(dialog, "Save my details")!.click());
    await vi.waitFor(() => expect(host!.textContent).toContain("Ada Lovelace"));

    expect(myProfileUpdateSchema.parse(patches[0])).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(onNamesSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Lovelace", firstName: "Ada" }));
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

  it("asks someone who represents no organization how they are joining, and no one else", () => {
    const onChange = vi.fn();
    const view = mount(applicant([personal]), onChange);
    const cards = Array.from(view.querySelectorAll<HTMLInputElement>('input[name="joinPath"]'));
    expect(cards.map((card) => card.value)).toEqual(["organization", "individual"]);
    // Neither way in is assumed: the individual capacity is the person's own statement.
    expect(cards.some((card) => card.checked)).toBe(false);
    expect(view.querySelector("legend")?.textContent).toBe("How are you joining?");
    expect(view.textContent).toContain(EMAIL_FIRST_COPY.join.personal.description);
    render(null, view);

    expect(mount(applicant([representation, personal])).querySelector('input[name="joinPath"]')).toBeNull();
    render(null, host!);
    expect(mount(applicant([personal, representation])).querySelector('input[name="joinPath"]')).toBeNull();
  });

  it("applies as the organization identity on /join/ without typed details or a path question", async () => {
    const requests = openJoinPage([representation], ({ path }) =>
      path === "/api/v1/members/applications/form" ? Response.json(definition) : new Response(null, { status: 404 }),
    );

    await import("../../assets/ts/member-flows/join-form");

    const form = document.querySelector<HTMLFormElement>("[data-join-application-form]")!;
    await vi.waitFor(() => expect(form.hidden).toBe(false));
    expect(document.querySelector<HTMLElement>("[data-join-sign-in]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-join-signed-in]")?.textContent).toContain("Example Corp");
    expect(document.querySelector('input[name="joinPath"]')).toBeNull();
    expect(form.querySelector<HTMLElement>("[data-join-typed-identity]")?.hidden).toBe(true);
    const categories = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="membershipCategory"]'));
    expect(categories.map((input) => input.value)).toEqual(["A"]);
    expect(form.querySelector('[name="custom.about_yourself"]')).toBeNull();
    expect(form.querySelector('[name="custom.about_organization"]')).not.toBeNull();
    // The membership path is only resolved for someone who represents no organization yet.
    expect(requests.map(({ path }) => path)).toEqual(["/api/v1/members/applications/form"]);
  });

  it("resolves the chosen path from the session and shows what the server decides", async () => {
    const decisions: Record<string, unknown> = {
      organization: {
        status: "organization_selection_required",
        domain: "example-corp.test",
        organizations: [{ id: ORGANIZATION_ID, name: "Example Corp" }],
        affiliation: {
          email: "ada@example-corp.test",
          domain: "example-corp.test",
          domains: [],
          organization: null,
          organizations: [],
        },
      },
      individual: {
        status: "application_ready",
        applicantEmail: "ada@example-corp.test",
        applicantKind: "individual",
        joinToken: "a".repeat(32),
      },
    };
    const requests = openJoinPage([personal], ({ path, body }) => {
      if (path === "/api/v1/members/applications/form") return Response.json(definition);
      const choice = memberJoinVerifySchema.parse(body);
      return Response.json(decisions[choice.unaffiliatedAttestation ? "individual" : "organization"]);
    });
    await import("../../assets/ts/member-flows/join-form");
    await vi.waitFor(() => expect(document.querySelector('input[name="joinPath"]')).not.toBeNull());
    const form = document.querySelector<HTMLFormElement>("[data-join-application-form]")!;
    expect(form.hidden).toBe(true);
    expect(requests).toEqual([]);

    await choosePath("organization");
    await vi.waitFor(() => expect(document.querySelector("select")).not.toBeNull());
    expect(document.querySelector("select")?.closest("form")?.querySelector("h2")?.textContent).toBe(
      "Choose your organization",
    );
    expect(requests).toEqual([{ path: "/api/v1/members/join/verify", body: { unaffiliatedAttestation: false } }]);
    expect(form.hidden).toBe(true);

    // An individual applies as the identity they hold: nothing about them is typed.
    await choosePath("individual");
    await vi.waitFor(() => expect(form.hidden).toBe(false));
    expect(requests[1]).toEqual({ path: "/api/v1/members/join/verify", body: { unaffiliatedAttestation: true } });
    expect(form.querySelector<HTMLElement>("[data-join-typed-identity]")?.hidden).toBe(true);
    const categories = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="membershipCategory"]'));
    expect(categories.map((input) => input.value)).toEqual(["H6"]);
  });

  it("asks for the organization and the applicant's name when applying for one they do not represent yet", async () => {
    openJoinPage([personal], ({ path }) =>
      path === "/api/v1/members/applications/form"
        ? Response.json(definition)
        : Response.json({
            status: "application_ready",
            applicantEmail: "ada@example-corp.test",
            applicantKind: "organization",
            organizationName: "Example Corp",
            joinToken: "a".repeat(32),
          }),
    );
    await import("../../assets/ts/member-flows/join-form");
    await vi.waitFor(() => expect(document.querySelector('input[name="joinPath"]')).not.toBeNull());
    await choosePath("organization");
    const form = document.querySelector<HTMLFormElement>("[data-join-application-form]")!;
    await vi.waitFor(() => expect(form.hidden).toBe(false));
    expect(form.querySelector<HTMLElement>("[data-join-typed-identity]")?.hidden).toBe(false);
    // Their account already knows their name, and the server fixed the organization they chose.
    expect(form.querySelector<HTMLInputElement>('[name="firstName"]')?.value).toBe("Ada");
    expect(form.querySelector<HTMLInputElement>('[name="lastName"]')?.value).toBe("Lovelace");
    const organization = form.querySelector<HTMLInputElement>('[name="organizationName"]')!;
    expect(organization.value).toBe("Example Corp");
    expect(organization.readOnly).toBe(true);
  });

  it("says to use a work address when a personal mailbox asks to join for an organization", async () => {
    openJoinPage([personal], () =>
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request",
            details: { formErrors: [], fieldErrors: { email: [WORK_EMAIL_STEER] } },
          },
        },
        { status: 400 },
      ),
    );
    await import("../../assets/ts/member-flows/join-form");
    await vi.waitFor(() => expect(document.querySelector('input[name="joinPath"]')).not.toBeNull());
    await choosePath("organization");
    const status = document.querySelector<HTMLElement>("[data-flow-status]")!;
    await vi.waitFor(() => expect(status.textContent).toBe(WORK_EMAIL_STEER));
    expect(document.querySelector<HTMLFormElement>("[data-join-application-form]")?.hidden).toBe(true);
  });
});
