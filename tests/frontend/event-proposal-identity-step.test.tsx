// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventProposalIdentityStep } from "../../assets/ts/components/EventProposalIdentityStep";
import {
  eventProposalProofVerifySchema,
  eventProposalProofStartSchema,
  eventProposalProofPersonPatchSchema,
  eventProposalProofIdentityPatchSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import type { ProposalEntryContext } from "../../assets/shared/schemas/proposal-entry";
import type { ProposalEntrySelection } from "../../assets/ts/components/useProposalEntryIdentity";

let host: HTMLDivElement | undefined;
let selection: ProposalEntrySelection | null;
const TOKEN = "v".repeat(40);
const endpoint = "/api/v1/events/pqc-2026/proposals/proof";
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function mount(enabled = true, entryContext?: ProposalEntryContext) {
  host = document.createElement("div");
  document.body.append(host);
  return act(() =>
    render(
      <EventProposalIdentityStep
        enabled={enabled}
        entryContext={entryContext}
        eventSlug="pqc-2026"
        consents={() => [{ termKey: "speaker-agreement", version: "1" }]}
        onChange={(value) => {
          selection = value;
        }}
      />,
      host!,
    ),
  );
}
afterEach(() => {
  if (host) render(null, host);
  document.body.innerHTML = "";
  host = undefined;
  selection = null;
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
describe("verified event entry", () => {
  it("does not resolve profiles or send proof before the terms step activates", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await mount(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(host!.textContent).toBe("");
  });
  it("does not load a different signed-in account's profile or catalog for a speaker invitation", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        paths.push(String(input));
        return response({
          success: true,
          sessionId: "00000000-0000-4000-8000-000000000095",
          identity: { id: "00000000-0000-4000-8000-000000000099", email: "other@example.test" },
          eventParticipation: true,
          expiresAt: "2099-12-31T23:59:59.000Z",
          idleExpiresAt: "2099-12-31T23:59:59.000Z",
        });
      }),
    );
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <EventProposalIdentityStep
          enabled
          eventSlug="pqc-2026"
          consents={() => []}
          speakerManagementToken={"s".repeat(40)}
          expectedSpeakerUserId="00000000-0000-4000-8000-000000000041"
          onChange={(value) => {
            selection = value;
          }}
        />,
        host!,
      ),
    );
    await vi.waitFor(() => expect(host!.querySelector('input[value="organization"]')).not.toBeNull());
    await act(() => {
      const yes = host!.querySelector<HTMLInputElement>('input[value="organization"]')!;
      yes.checked = true;
      yes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host!.querySelector('input[name="email"]')).not.toBeNull();
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
    expect(paths).toEqual(["/api/v1/auth/session"]);
    expect(selection).toBeNull();
  });
  it("uses verified known details as a summary without personal inputs", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/propose/#verify=${TOKEN}`);
    const requests: unknown[] = [];
    const nameRequests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        if (init.method === "PATCH") {
          nameRequests.push(JSON.parse(init.body));
          if (nameRequests.length === 1)
            return response({ error: { code: "SAVE_REFUSED", message: "Please retry saving your name." } }, 500);
          return response({
            person: {
              email: "ada@example.test",
              firstName: "Augusta Ada",
              lastName: "Lovelace",
              organizationName: null,
              jobTitle: null,
              bio: null,
              links: [],
            },
          });
        }
        requests.push(JSON.parse(init.body));
        return response({
          status: "ready",
          continuationToken: "c".repeat(40),
          applicantKind: "organization",
          email: "ada@example.test",
          organization: { id: "00000000-0000-4000-8000-000000000044", name: "Example Organization" },
          person: {
            email: "ada@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        });
      }),
    );
    await mount();
    await vi.waitFor(() => expect(selection?.person.firstName).toBe("Ada"));
    expect(eventProposalProofVerifySchema.parse(requests[0]).token).toBe(TOKEN);
    expect(host!.querySelector(".pk-datalist")?.textContent).toContain("Ada Lovelace");
    expect(host!.querySelector(".pk-datalist")?.textContent).not.toContain("Example Organization");
    expect(host!.querySelector(".pk-datalist")?.textContent).not.toContain("Engineer");
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    expect(host!.querySelector('input[name="jobTitle"]')).toBeNull();
    expect(host!.textContent).toContain("No existing representation is selected.");
    expect(host!.textContent).not.toContain("This new representation");
    expect(selection?.missingDetails).toEqual({});
    await act(() => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit my details")!
        .click();
    });
    await act(() => {
      const first = host!.querySelector<HTMLInputElement>('input[name="firstName"]')!;
      first.value = "Augusta";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Save my details")!
        .click();
    });
    await vi.waitFor(() => expect(host!.textContent).toContain("Please retry saving your name."));
    expect(host!.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe("Augusta");
    await act(async () => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Save my details")!
        .click();
    });
    await vi.waitFor(() => expect(host!.querySelector(".pk-datalist")?.textContent).toContain("Augusta Ada Lovelace"));
    expect(nameRequests).toHaveLength(2);
    expect(eventProposalProofPersonPatchSchema.parse(nameRequests[1])).toEqual(
      eventProposalProofPersonPatchSchema.parse(nameRequests[0]),
    );
    const savedNames = eventProposalProofPersonPatchSchema.parse(nameRequests[0]);
    expect(savedNames).toEqual({ firstName: "Augusta", lastName: "Lovelace", continuationToken: "c".repeat(40) });
    expect(selection?.person.firstName).toBe("Augusta Ada");
    expect(selection?.missingDetails).toEqual({});
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
  });
  it("selects an owned organization identity using canonical names without duplicate profile inputs", async () => {
    const userId = "00000000-0000-4000-8000-000000000041";
    const identityId = "00000000-0000-4000-8000-000000000042";
    const now = "2026-01-01T00:00:00.000Z";
    const urls: URL[] = [];
    const roleRequests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = new URL(String(input), location.origin);
        urls.push(url);
        if (url.pathname === `${endpoint}/identities/${identityId}`) {
          roleRequests.push(JSON.parse(init.body));
          return response({ identityId, jobTitle: roleRequests.length === 1 ? "Principal Engineer" : null });
        }
        if (url.pathname === "/api/v1/auth/session")
          return response({
            success: true,
            sessionId: "00000000-0000-4000-8000-000000000096",
            identity: { id: userId, email: "ada@example.test" },
            eventParticipation: true,
            expiresAt: "2099-12-31T23:59:59.000Z",
            idleExpiresAt: "2099-12-31T23:59:59.000Z",
          });
        if (url.pathname === `/api/v1/users/${userId}`)
          return response({
            user: {
              id: userId,
              email: "ada@example.test",
              first_name: "Ada",
              last_name: "Lovelace",
              preferred_name: null,
              active: true,
              isEcMember: false,
              created_at: now,
              updated_at: now,
              pii_redacted_at: null,
              headshotUrl: null,
              identities: [],
              formerIdentities: [],
            },
          });
        if (url.pathname === "/api/v1/users/current/identities")
          return response({
            identities: [
              {
                id: identityId,
                memberId: null,
                organizationId: "00000000-0000-4000-8000-000000000044",
                organizationName: "Nonmember Organization",
                membershipCategory: null,
                userId,
                userName: "Do not split this display name",
                emailId: "00000000-0000-4000-8000-000000000046",
                email: "ada@example.test",
                jobTitle: "Engineer",
                biography: null,
                links: [],
                headshotUrl: null,
                source: "verified_email",
                state: "active",
                showOnOrganizationProfile: true,
                invitedAt: now,
                startedAt: now,
                endedAt: null,
                blockedAt: null,
                blockedByUserId: null,
                predecessorIdentityId: null,
                createdAt: now,
                updatedAt: now,
              },
            ],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          });
        throw new Error("Unexpected request");
      }),
    );
    await mount();
    await vi.waitFor(() => expect(host!.querySelector('input[value="organization"]')).not.toBeNull());
    await act(() => {
      const yes = host!.querySelector<HTMLInputElement>('input[value="organization"]')!;
      yes.checked = true;
      yes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await vi.waitFor(() => expect(host!.querySelector('[role="combobox"]')).not.toBeNull());
    await act(() => {
      host!.querySelector<HTMLElement>('[role="combobox"]')!.click();
    });
    await vi.waitFor(() => expect(host!.querySelector(`[role="option"][data-key="${identityId}"]`)).not.toBeNull());
    await act(() => {
      host!.querySelector<HTMLElement>(`[role="option"][data-key="${identityId}"]`)!.click();
    });
    expect(selection?.person.firstName).toBe("Ada");
    expect(selection?.person.lastName).toBe("Lovelace");
    expect(selection?.actingIdentityId).toBe(identityId);
    expect(selection?.person.organizationName).toBe("Nonmember Organization");
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    expect(host!.querySelector('input[name="jobTitle"]')).toBeNull();
    expect(urls.find((url) => url.pathname.endsWith("identities"))?.searchParams.get("organizationOnly")).toBe("true");
    expect(host!.textContent).not.toContain("Your current representation is updated.");
    await act(() => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Update current representation")!
        .click();
    });
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    await act(() => {
      const role = host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
      role.value = "Principal Engineer";
      role.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Save representation")!
        .click();
    });
    await vi.waitFor(() => expect(selection?.person.jobTitle).toBe("Principal Engineer"));
    expect(eventProposalProofIdentityPatchSchema.parse(roleRequests[0])).toEqual({ jobTitle: "Principal Engineer" });
    expect(selection?.actingIdentityId).toBe(identityId);
    expect(selection?.person.organizationName).toBe("Nonmember Organization");
    expect(host!.querySelector('input[name="jobTitle"]')).toBeNull();
    expect(host!.querySelector('[role="status"]')?.textContent).toBe("Your current representation is updated.");
    await act(() => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Update current representation")!
        .click();
    });
    expect(host!.textContent).not.toContain("Your current representation is updated.");
    await act(() => {
      const role = host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
      role.value = "";
      role.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Save representation")!
        .click();
    });
    await vi.waitFor(() => expect(selection?.person.jobTitle).toBeNull());
    expect(eventProposalProofIdentityPatchSchema.parse(roleRequests[1]).jobTitle).toBeNull();
    expect(selection?.person.organizationName).toBe("Nonmember Organization");
  });
  it("asks only missing verified-person details and retains a claimed organization name", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/propose/#verify=${TOKEN}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          status: "ready",
          continuationToken: "c".repeat(40),
          applicantKind: "organization",
          email: "ada@example.test",
          organization: { id: "00000000-0000-4000-8000-000000000044", name: "Example Organization" },
          person: null,
        }),
      ),
    );
    await mount();
    await vi.waitFor(() => expect(host!.querySelector('input[name="firstName"]')).not.toBeNull());
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    expect(host!.querySelector('input[name="email"]')).toBeNull();
    await act(() => {
      const first = host!.querySelector<HTMLInputElement>('input[name="firstName"]')!;
      first.value = "Ada";
      first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(selection?.missingDetails.firstName).toBe("Ada");
    expect(host!.textContent).toContain("These new details are not saved yet.");
    expect(host!.textContent).not.toContain("verified profile");
    expect(host!.querySelectorAll('input[name="firstName"]')).toHaveLength(1);
    expect(host!.querySelector(".pk-datalist")?.textContent).not.toContain("Ada");
    expect(host!.querySelector(".pk-datalist")?.textContent).toContain("Example Organization");
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
    expect(selection?.person.organizationName).toBe("Example Organization");
  });
  it("keeps known names read-only while new affiliation drafts appear only in missing-detail inputs", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/propose/#verify=${TOKEN}`);
    const addRequests: unknown[] = [];
    const verifiedTokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url) === endpoint) {
          addRequests.push(JSON.parse(init.body));
          return response({ status: "verification_sent" });
        }
        const verified = eventProposalProofVerifySchema.parse(JSON.parse(init.body));
        verifiedTokens.push(verified.token);
        const verifiedEmail = verified.token === TOKEN ? "ada@new-work.example.test" : "ada@another-work.example.test";
        return response({
          status: "ready",
          continuationToken: "c".repeat(40),
          entryContext: { sourceType: "direct" },
          applicantKind: "organization",
          email: verifiedEmail,
          organization: null,
          person: {
            email: verifiedEmail,
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        });
      }),
    );
    await mount();
    await vi.waitFor(() => expect(selection?.person.firstName).toBe("Ada"));
    await act(() => {
      for (const [name, value] of [
        ["organizationName", "New affiliation"],
        ["jobTitle", "New role"],
      ]) {
        const input = host!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        input.value = value!;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect([...host!.querySelectorAll("legend")].map((legend) => legend.textContent)).toContain(
      "Your personal details",
    );
    expect([...host!.querySelectorAll("legend")].map((legend) => legend.textContent)).toContain(
      "Your representation for this proposal",
    );
    expect(host!.textContent).toContain("Any details entered below are unsaved");
    expect(host!.textContent).not.toContain("This new representation");
    expect(host!.textContent).not.toContain("Complete your details");
    expect(host!.querySelectorAll('input[name="organizationName"]')).toHaveLength(1);
    const summary = host!.querySelector(".pk-datalist")!;
    expect(summary.textContent).toContain("Ada Lovelace");
    expect(summary.textContent).not.toContain("ada@new-work.example.test");
    expect(host!.textContent).toContain("ada@new-work.example.test");
    expect(summary.textContent).not.toContain("New affiliation");
    expect(summary.textContent).not.toContain("New role");
    expect([...summary.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Name"]);
    expect(selection?.missingDetails).toEqual({ organizationName: "New affiliation", jobTitle: "New role" });
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
    await act(() => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Clear unsaved changes")!
        .click();
    });
    expect(host!.querySelector<HTMLInputElement>('input[name="organizationName"]')!.value).toBe("");
    expect(host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.value).toBe("");
    expect(selection?.person.firstName).toBe("Ada");
    expect(selection?.missingDetails).toEqual({});
    expect(addRequests).toHaveLength(0);
    await act(() => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Add representation")!
        .click();
    });
    await act(() => {
      const email = host!.querySelector<HTMLInputElement>('input[name="email"]')!;
      email.value = "ada@another-work.example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Verify organization email")!
        .click();
    });
    await vi.waitFor(() => expect(addRequests).toHaveLength(1));
    const add = eventProposalProofStartSchema.parse(addRequests[0]);
    expect(add.continuationToken).toBe("c".repeat(40));
    expect(add.entryContext).toBeUndefined();
    expect(add.speakerManagementToken).toBeUndefined();
    expect(add.email).toBe("ada@another-work.example.test");
    expect(selection).toBeNull();
    await vi.waitFor(() => expect(host!.textContent).toContain("Check your email"));
    await act(async () => {
      const changed = new Promise<void>((resolve) =>
        window.addEventListener("hashchange", () => resolve(), { once: true }),
      );
      location.hash = `verify=${"n".repeat(40)}`;
      await changed;
    });
    await vi.waitFor(() => expect(selection?.person.email).toBe("ada@another-work.example.test"));
    expect(verifiedTokens).toEqual([TOKEN, "n".repeat(40)]);
    expect(selection?.person.firstName).toBe("Ada");
    expect(host!.textContent).not.toContain("Check your email");
  });
  it("sends joining qualification and accepted terms before revealing personal fields", async () => {
    const captured: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("auth/session"))
          return response({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, 401);
        if (String(url) === endpoint) {
          captured.push(JSON.parse(init.body));
          return response({ status: "verification_sent" });
        }
        throw new Error("Unexpected identity enumeration");
      }),
    );
    await mount(true, {
      inviteToken: "original-invitation-capability",
      sourceType: "invite",
      sourceRef: "invite",
      referralCode: "ABC12345",
    });
    await vi.waitFor(() => expect(host!.querySelector('input[value="organization"]')).not.toBeNull());
    await act(() => {
      const yes = host!.querySelector<HTMLInputElement>('input[value="organization"]')!;
      yes.checked = true;
      yes.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      const email = host!.querySelector<HTMLInputElement>('input[name="email"]')!;
      email.value = "ada@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(host!.querySelectorAll("button"))
        .find((button) => button.textContent === "Verify organization email")!
        .click();
    });
    await vi.waitFor(() => expect(captured).toHaveLength(1));
    const parsed = eventProposalProofStartSchema.parse(captured[0]);
    expect(parsed.email).toBe("ada@example.test");
    expect(parsed.entryContext).toMatchObject({
      inviteToken: "original-invitation-capability",
      sourceType: "invite",
      sourceRef: "invite",
      referralCode: "ABC12345",
    });
    expect(parsed.unaffiliatedAttestation).toBe(false);
    expect(parsed.consents).toEqual([{ termKey: "speaker-agreement", version: "1" }]);
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(selection).toBeNull();
  });
});
