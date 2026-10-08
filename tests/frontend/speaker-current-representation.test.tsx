// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  signedInSession,
  speakerPage,
  speakerTerms,
} from "./helpers/speaker-manage-page-fixture";

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/speaker/?token=speaker-token-12345678901234567890");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("speaker current representation", () => {
  it("shows and reopens the live representation while preserving its recorded appearance", async () => {
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
        return json({ identityId: "00000000-0000-4000-8000-000000000042", jobTitle: "Lead Engineer" });
      },
    });
    await boot();
    expect(panel(root, "data-speaker-identity").textContent).toContain("Current Example Labs");
    expect(panel(root, "data-speaker-identity").textContent).toContain("Current Engineer");
    for (const field of ["firstName", "lastName", "organizationName", "jobTitle"])
      expect(root.querySelector(`input[name="${field}"]`)).toBeNull();
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
      const first = root.querySelector<HTMLInputElement>('input[name="firstName"]')!;
      first.value = "Augusta";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(root.querySelectorAll("button"))
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
    await act(() => {
      Array.from(root.querySelectorAll("button"))
        .find((button) => button.textContent === "Update current representation")!
        .click();
    });
    expect(root.querySelector('input[name="organizationName"]')).toBeNull();
    await act(() => {
      const role = root.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
      role.value = "Lead Engineer";
      role.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(root.querySelectorAll("button"))
        .find((button) => button.textContent === "Save representation")!
        .click();
    });
    await vi.waitFor(() => expect(root.textContent).toContain("Your current representation is updated."));
    const updatedRole = requests.find(({ path }) => path.includes("/proof/identities/"))!;
    expect(eventProposalProofIdentityPatchSchema.parse(updatedRole.body)).toEqual({
      jobTitle: "Lead Engineer",
      speakerManagementToken: "speaker-token-12345678901234567890",
    });
    expect((data.profile as Record<string, unknown>).jobTitle).toBe("Recorded Engineer");
    expect(panel(root, "data-speaker-identity").textContent).toContain("Lead Engineer");
    await act(() => {
      Array.from(root.querySelectorAll("button"))
        .find((button) => button.textContent === "Update current representation")!
        .click();
    });
    expect(root.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.value).toBe("Lead Engineer");
    expect((data.profile as Record<string, unknown>).jobTitle).toBe("Recorded Engineer");
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
    expect(identity.textContent).toContain("Choose another representation");
    expect(identity.textContent).toContain("Add representation");
    expect((data.profile as Record<string, unknown>).jobTitle).toBe("Recorded Engineer");
  });
});
