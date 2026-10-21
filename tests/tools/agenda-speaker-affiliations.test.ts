import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";
import { describe, expect, it } from "vitest";
import {
  affiliationLabel,
  affiliationsLine,
  agendaAffiliationContent,
  agendaCreditedOrganizationIds,
  creditAffiliations,
  titleWithoutOrganization,
} from "../../assets/shared/agenda-speaker-affiliations";
import { sessionAppearanceSchema } from "../../assets/shared/schemas/event-session-history";

const appearance = (affiliations: unknown[]) =>
  sessionAppearanceSchema.parse({
    userId: "person",
    displayName: "Speaker",
    affiliations,
    photoUrl: null,
    approvedAt: "2026-10-01T00:00:00.000Z",
  });

describe("speaker affiliations", () => {
  it("shows an organization once even when a legacy title already names it", () => {
    expect(titleWithoutOrganization("President, LDIQ", "LDIQ")).toBe("President");
    expect(titleWithoutOrganization("CEO at Digitorus", "Digitorus")).toBe("CEO");
    expect(titleWithoutOrganization("LDIQ", "LDIQ")).toBe("");
    // A case-insensitive coincidence inside another word or title is not the organization.
    expect(titleWithoutOrganization("IT security lead", "It")).toBe("IT security lead");
    expect(
      affiliationLabel(
        agendaAffiliationContent(undefined, {
          identityId: null,
          title: "President, LDIQ",
          organizationId: null,
          organizationName: "LDIQ",
        }),
      ),
    ).toBe("President · LDIQ");
  });

  it("projects each organization's live logo by its ID and leaves one without a logo as a name", () => {
    const organizations = { org: { name: "PKI Consortium", logoUrl: "/api/v1/members/org/logo" } };
    expect(
      agendaAffiliationContent(organizations, {
        identityId: "identity",
        title: "Chair",
        organizationId: "org",
        organizationName: "PKI Consortium",
      }),
    ).toEqual({ title: "Chair", organization: { name: "PKI Consortium", logoSrc: "/api/v1/members/org/logo" } });
    expect(
      agendaAffiliationContent(organizations, {
        identityId: null,
        title: "CEO",
        organizationId: null,
        organizationName: "Digitorus",
      }),
    ).toEqual({ title: "CEO", organization: { name: "Digitorus" } });
  });

  it("keeps an appearance's capacities in order and reads a source credit as one capacity", () => {
    const credit = appearance([
      { identityId: "a", title: "Chair", organizationId: "org-a", organizationName: "PKI Consortium" },
      { identityId: "b", title: "CEO", organizationId: "org-b", organizationName: "Digitorus" },
    ]);
    expect(creditAffiliations(credit).map((value) => value.title)).toEqual(["Chair", "CEO"]);
    const occurrence = structuredClone(approvedAgendaSnapshot.occurrences[0]!);
    occurrence.speakers = [];
    occurrence.history!.appearances = [credit];
    expect(agendaCreditedOrganizationIds([occurrence])).toEqual(["org-a", "org-b"]);
    expect(creditAffiliations({ jobTitle: "Researcher", organizationName: null })).toEqual([
      { identityId: null, title: "Researcher", organizationId: null, organizationName: null },
    ]);
    expect(creditAffiliations({ jobTitle: null, organizationName: null })).toEqual([]);
  });

  it("names every organization on a lower third, which draws no logos", () => {
    expect(
      affiliationsLine([
        { title: "Chair", organization: { name: "PKI Consortium", logoSrc: "/logo.svg" } },
        { title: "CEO", organization: { name: "Digitorus" } },
        { organization: { name: "Example" } },
      ]),
    ).toBe("Chair · PKI Consortium | CEO · Digitorus | Example");
    expect(affiliationsLine(undefined)).toBe("");
  });

  it("refuses a repeated representation or an empty capacity", () => {
    const chair = { identityId: "a", title: "Chair", organizationId: null, organizationName: "PKI Consortium" };
    expect(() => appearance([chair, chair])).toThrow(/each representation once/u);
    expect(() =>
      appearance([{ identityId: null, title: null, organizationId: null, organizationName: null }]),
    ).toThrow();
  });
});
