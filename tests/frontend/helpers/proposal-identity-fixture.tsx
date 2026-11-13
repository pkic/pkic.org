import { render, type ComponentProps } from "preact";
import { act } from "preact/test-utils";
import { EventProposalIdentityStep } from "../../../assets/ts/components/EventProposalIdentityStep";
import {
  actingIdentitySchema,
  identitiesListResponseSchema,
  type ActingIdentity,
} from "../../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { userDetailResponseSchema } from "../../../assets/shared/schemas/user-management";

export const PROPOSER_USER_ID = "00000000-0000-4000-8000-000000000041";
export const PROPOSER_IDENTITY_ID = "00000000-0000-4000-8000-000000000042";
export const PROPOSER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000044";
const NOW = "2026-01-01T00:00:00.000Z";

/**
 * A speaker's own link: the step then confirms a mailbox instead of asking for a session.
 * The mailbox paths a proposer no longer has stay covered through it.
 */
export const SPEAKER_LINK = {
  speakerManagementToken: "s".repeat(40),
  expectedSpeakerUserId: PROPOSER_USER_ID,
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The session read's answer when nobody is signed in. */
export function signedOutResponse(): Response {
  return json({ error: { code: "AUTH_INVALID", message: "Invalid user session token" } }, 401);
}

/** One organization identity the signed-in proposer holds. */
export function proposerIdentity(overrides: Partial<ActingIdentity> = {}): ActingIdentity {
  return actingIdentitySchema.parse({
    id: PROPOSER_IDENTITY_ID,
    memberId: null,
    organizationId: PROPOSER_ORGANIZATION_ID,
    organizationName: "Nonmember Organization",
    membershipCategory: null,
    userId: PROPOSER_USER_ID,
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
    invitedAt: NOW,
    startedAt: NOW,
    endedAt: null,
    blockedAt: null,
    blockedByUserId: null,
    predecessorIdentityId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

/**
 * The three reads a signed-in proposer's step makes: the session, the account's saved names, and the
 * identities it can take part as. Answers `undefined` for any other path, so a test adds its own routes.
 */
export function signedInProposer({
  email = "ada@example.test",
  firstName = "Ada",
  lastName = "Lovelace",
  identities = [],
}: {
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  identities?: ActingIdentity[];
} = {}): (path: string) => Response | undefined {
  return (path) => {
    if (path === "/api/v1/auth/session")
      return json(
        userAuthSessionResponseSchema.parse({
          success: true,
          sessionId: "00000000-0000-4000-8000-000000000096",
          identity: { id: PROPOSER_USER_ID, email },
          eventParticipation: true,
          expiresAt: "2099-12-31T23:59:59.000Z",
          idleExpiresAt: "2099-12-31T23:59:59.000Z",
        }),
      );
    if (path === `/api/v1/users/${PROPOSER_USER_ID}`)
      return json(
        userDetailResponseSchema.parse({
          user: {
            id: PROPOSER_USER_ID,
            email,
            first_name: firstName,
            last_name: lastName,
            preferred_name: null,
            active: true,
            isEcMember: false,
            created_at: NOW,
            updated_at: NOW,
            pii_redacted_at: null,
            headshotUrl: null,
            identities: [],
            formerIdentities: [],
          },
        }),
      );
    if (path === "/api/v1/users/current/identities")
      return json(
        identitiesListResponseSchema.parse({
          identities,
          page: { limit: 25, offset: 0, total: identities.length, hasMore: false },
        }),
      );
    return undefined;
  };
}

/** Choose one of the signed-in proposer's identities through the representation picker. */
export async function chooseProposerIdentity(host: HTMLElement, identityId: string): Promise<void> {
  const option = () => host.querySelector<HTMLElement>(`[role="option"][data-key="${identityId}"]`);
  const deadline = Date.now() + 2_000;
  while (!host.querySelector('[role="combobox"]') && Date.now() < deadline)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(() => {
    host.querySelector<HTMLElement>('[role="combobox"]')!.click();
  });
  while (!option() && Date.now() < deadline)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(() => {
    option()!.click();
  });
}

/** Confirm a proposed organization through the visible chooser. */
export async function chooseProposalOrganization(host: HTMLElement, organizationId: string) {
  const choice = host.querySelector("select")!;
  if (choice.value) throw new Error("The organization must not be preselected");
  await act(() => {
    choice.value = organizationId;
    choice.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Mount the actual identity step with synthetic event defaults: a proposer, or a speaker with their link. */
export async function mountProposalIdentityStep(
  props: Pick<ComponentProps<typeof EventProposalIdentityStep>, "enabled" | "onChange"> &
    Partial<
      Pick<
        ComponentProps<typeof EventProposalIdentityStep>,
        "speakerManagementToken" | "expectedSpeakerUserId" | "invitedEmail"
      >
    >,
) {
  const host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <EventProposalIdentityStep
        {...props}
        eventSlug="pqc-2026"
        consents={() => [{ termKey: "speaker-agreement", version: "1" }]}
      />,
      host,
    ),
  );
  return host;
}
