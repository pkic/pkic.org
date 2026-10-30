// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { eventProposalProofIdentityPatchSchema } from "../../assets/shared/schemas/event-proposal-proof";
import {
  AUTH,
  READ,
  TERMS,
  boot,
  installApi,
  json,
  mountShell,
  panel,
  profileReceipt,
  resetSpeakerPageBetweenTests,
  signedInSession,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";

resetSpeakerPageBetweenTests();

describe("speaker current representation", () => {
  it("shows the live representation and edits its profile on the identity itself", async () => {
    const root = mountShell();
    const data = speakerPage();
    data.profile = {
      ...(data.profile as Record<string, unknown>),
      actingIdentityId: "00000000-0000-4000-8000-000000000042",
      actingIdentitySelectedAt: "2026-01-01T00:00:00.000Z",
      actingIdentitySelection: "identity",
      organizationName: "Recorded Example Labs",
      jobTitle: "Recorded Engineer",
    };
    data.currentRepresentation = {
      identityId: "00000000-0000-4000-8000-000000000042",
      actingIdentityId: "00000000-0000-4000-8000-000000000042",
      actingIdentitySelectedAt: "2026-01-01T00:00:00.000Z",
      actingIdentitySelection: "identity",
      emailId: "00000000-0000-4000-8000-000000000043",
      email: "ada@work.example.test",
      organizationId: "00000000-0000-4000-8000-000000000044",
      organizationName: "Current Example Labs",
      jobTitle: "Current Engineer",
      biography: null,
      links: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const requests = installApi({
      [READ]: () => json(data),
      [TERMS]: () => json(speakerTerms()),
      [`${READ}/profile`]: () => {
        (data.profile as Record<string, unknown>).firstName = "Augusta Ada";
        return profileReceipt(data);
      },
      [AUTH]: () => signedInSession(),
      ["/api/v1/events/pqc-2026/proposals/proof/identities/00000000-0000-4000-8000-000000000042"]: () => {
        (data.currentRepresentation as Record<string, unknown>).jobTitle = "Lead Engineer";
        return json({
          identityId: "00000000-0000-4000-8000-000000000042",
          organizationId: "00000000-0000-4000-8000-000000000044",
          jobTitle: "Lead Engineer",
          biography: null,
          links: [],
        });
      },
    });
    await boot();
    expect(panel(root, "data-speaker-identity").textContent).toContain("Current Example Labs");
    expect(panel(root, "data-speaker-identity").textContent).toContain("Current Engineer");
    for (const field of ["firstName", "lastName", "organizationName", "jobTitle"])
      expect(panel(root, "data-speaker-identity").querySelector(`input[name="${field}"]`)).toBeNull();
    expect(panel(root, "data-speaker-identity").textContent).toContain("ada@work.example.test");
    expect(panel(root, "data-speaker-identity").textContent).not.toContain("ada@example.test");
    expect(root.querySelector('[role="combobox"]')).toBeNull();
    expect(requests.every(({ path }) => path === READ || path === TERMS)).toBe(true);
    await act(() => {
      Array.from(root.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit my details")!
        .click();
    });
    await act(() => {
      const first = document.querySelector<HTMLInputElement>('dialog[open] input[name="firstName"]')!;
      first.value = "Augusta";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] button"))
        .find((button) => button.textContent === "Save my details")!
        .click();
    });
    await vi.waitFor(() => expect(panel(root, "data-speaker-identity").textContent).toContain("Augusta Ada Lovelace"));
    const names = speakerSelfProfilePatchSchema.parse(requests.find(({ method }) => method === "PATCH")!.body);
    expect(names.firstName).toBe("Augusta");
    expect(names.lastName).toBe("Lovelace");
    expect(names.actingIdentityId).toBeUndefined();
    expect(names.continuationToken).toBeUndefined();
    expect(names.organizationName).toBeUndefined();
    expect(names.jobTitle).toBeUndefined();
    expect(panel(root, "data-speaker-identity").textContent).toContain("Current Example Labs");
    expect(panel(root, "data-speaker-identity").textContent).toContain("Current Engineer");
    // The representation's title, biography and links are edited in one place: the identity's own form.
    expect(panel(root, "data-speaker-identity").textContent).not.toContain("Update current representation");
    const identityForm = root.querySelector<HTMLFormElement>("[data-identity-profile-form] form")!;
    expect(panel(root, "data-identity-profile").hidden).toBe(false);
    expect(identityForm.querySelector('input[name="organizationName"]')).toBeNull();
    await act(() => {
      const role = identityForm.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
      role.value = "Lead Engineer";
      role.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      identityForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const updatedRole = requests.find(({ path }) => path.includes("/proof/identities/"))!;
    expect(eventProposalProofIdentityPatchSchema.parse(updatedRole.body)).toEqual({
      jobTitle: "Lead Engineer",
      biography: "",
      links: [],
      speakerManagementToken: "speaker-token-12345678901234567890",
    });
    await vi.waitFor(() => expect(panel(root, "data-speaker-identity").textContent).toContain("Lead Engineer"));
    vi.resetModules();
    const reloaded = mountShell();
    await boot();
    expect(panel(reloaded, "data-speaker-identity").textContent).toContain("Lead Engineer");
    expect(panel(reloaded, "data-speaker-identity").textContent).toContain("ada@work.example.test");
    expect(panel(reloaded, "data-speaker-identity").textContent).not.toContain("ada@example.test");
  });

  it("does not substitute a primary mailbox or expose editing when the live representation is unavailable", async () => {
    const root = mountShell();
    const data = speakerPage();
    data.profile = {
      ...(data.profile as Record<string, unknown>),
      actingIdentityId: "00000000-0000-4000-8000-000000000042",
      actingIdentitySelectedAt: "2026-01-01T00:00:00.000Z",
      actingIdentitySelection: "identity",
      organizationName: "Recorded Example Labs",
      jobTitle: "Recorded Engineer",
    };
    installApi({ [READ]: () => json(data), [TERMS]: () => json(speakerTerms()) });
    await boot();
    const identity = panel(root, "data-speaker-identity");
    expect(identity.textContent).toContain("The current representation is unavailable");
    expect(identity.textContent).not.toContain("ada@example.test");
    expect(identity.textContent).not.toContain("Individual participation");
    expect(identity.textContent).not.toContain("Update current representation");
    expect(panel(root, "data-identity-profile").hidden).toBe(true);
    expect(identity.textContent).toContain("Choose another representation");
    expect(identity.textContent).toContain("Add representation");
    expect((data.profile as Record<string, unknown>).jobTitle).toBe("Recorded Engineer");
  });
});
