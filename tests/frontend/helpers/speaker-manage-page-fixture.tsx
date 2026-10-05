import { expect, vi } from "vitest";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { EventSpeakerManagement } from "../../../assets/ts/site/EventSpeakerManagement";
import { speakerProfileUpdateResponseSchema } from "../../../assets/shared/schemas/speaker-self-service";
import { identitiesListResponseSchema } from "../../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { userDetailResponseSchema } from "../../../assets/shared/schemas/user-management";
import { toggleChoice } from "./labelled-control";

export const READ = "/api/v1/proposals/speakers/access/speaker-token-12345678901234567890";
export const TERMS = "/api/v1/events/pqc-2026/terms";
export const SPEAKER_USER_ID = "00000000-0000-4000-8000-000000000041";
export const AUTH = "/api/v1/auth/session";

export function signedInSession(userId = SPEAKER_USER_ID): Response {
  return json(
    userAuthSessionResponseSchema.parse({
      success: true,
      sessionId: "00000000-0000-4000-8000-000000000094",
      identity: { id: userId, email: "ada@example.test" },
      eventParticipation: true,
      expiresAt: "2099-12-31T23:59:59.000Z",
      idleExpiresAt: "2099-12-31T23:59:59.000Z",
    }),
  );
}

export function personDetail(): Response {
  const now = "2026-01-01T00:00:00.000Z";
  return json(
    userDetailResponseSchema.parse({
      user: {
        id: SPEAKER_USER_ID,
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
    }),
  );
}

export async function chooseIndividual(root: HTMLElement): Promise<void> {
  if (!root.querySelector('input[name="applicantKind"]')) {
    await act(() => {
      Array.from(root.querySelectorAll("button"))
        .find((button) => button.textContent === "Choose another representation")!
        .click();
    });
  }
  await toggleChoice(root.querySelector<HTMLInputElement>('input[name="applicantKind"][value="individual"]')!);
  await toggleChoice(root.querySelector<HTMLInputElement>('input[name="unaffiliatedAttestation"]')!);
}

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function speakerPage(overrides: { status?: string; proposalStatus?: string } = {}): Record<string, unknown> {
  return {
    speaker: {
      userId: SPEAKER_USER_ID,
      role: "speaker",
      status: overrides.status ?? "invited",
      confirmedAt: null,
      declinedAt: null,
      termsAcceptedAt: null,
    },
    proposal: {
      id: "30000000-0000-4000-8000-000000000001",
      title: "Post-quantum migration in practice",
      proposalType: "talk",
      status: overrides.proposalStatus ?? "submitted",
      presentationDeadline: null,
      presentationUploaded: false,
      presentationUploadedAt: null,
      presentationUploader: null,
      coSpeakers: [],
      presentationUrl: null,
    },
    currentRepresentation: null,
    presentationTerms: [],
    profile: {
      actingIdentityId: null,
      actingIdentitySelectedAt: null,
      actingIdentitySelection: "unrecorded",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      organizationName: null,
      jobTitle: null,
      biography: null,
      links: [],
      headshotUploaded: false,
      headshotUpdatedAt: null,
      headshotUrl: null,
    },
  };
}

/** The shape `eventTermsResponseSchema` demands, with no terms configured. */
export function speakerTerms(): Record<string, unknown> {
  return {
    event: { id: "20000000-0000-4000-8000-000000000001", slug: "pqc-2026", name: "PQC Conference 2026" },
    audience: "speaker",
    terms: [],
  };
}

export function installApi(routes: Record<string, () => Response | Promise<Response>>): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), location.origin);
      requests.push({
        path: url.pathname,
        method: (init.method ?? "GET").toUpperCase(),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const route = routes[url.pathname];
      return Promise.resolve(
        route
          ? route()
          : url.pathname === AUTH
            ? json({ error: "Unauthorized" }, 401)
            : url.pathname === `${READ}/identities`
              ? json(
                  identitiesListResponseSchema.parse({
                    identities: [],
                    page: { limit: 25, offset: 0, total: 0, hasMore: false },
                  }),
                )
              : json({}),
      );
    }),
  );
  return requests;
}

/** Exercise the actual reusable speaker shell and its controller together. */
export function mountShell(): HTMLElement {
  document.body.innerHTML = renderToString(<EventSpeakerManagement />);
  const root = document.querySelector<HTMLElement>("[data-event-speaker-manage]");
  if (!root) throw new Error("shell did not mount");
  root.dataset.eventSlug = "pqc-2026";
  return root;
}

export async function boot(): Promise<void> {
  await act(async () => {
    await import("../../../assets/ts/event-flows/speaker-manage-page");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The first visit loads the shared editor chunk before revealing the form.
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector<HTMLElement>("[data-speaker-loading]")?.hidden).toBe(true);
    },
    { timeout: 5_000 },
  );
}

export function panel(root: ParentNode, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[${name}]`);
  if (!element) throw new Error(`no element carries [${name}]`);
  return element;
}

/** Canonical saved selection receipt, independent of the recorded appearance. */
export function profileReceipt(data?: Record<string, unknown>): Response {
  const saved = data ?? speakerPage();
  if (!data) {
    const selectedAt = "2026-01-01T00:00:00.000Z";
    saved.profile = {
      ...(saved.profile as Record<string, unknown>),
      actingIdentitySelection: "individual",
      actingIdentitySelectedAt: selectedAt,
    };
    saved.currentRepresentation = {
      actingIdentityId: null,
      actingIdentitySelectedAt: selectedAt,
      actingIdentitySelection: "individual",
      emailId: null,
      email: "ada@example.test",
      organizationId: null,
      organizationName: null,
      jobTitle: null,
      biography: null,
      links: [],
      updatedAt: selectedAt,
    };
  }
  return json(
    speakerProfileUpdateResponseSchema.parse({
      success: true,
      profile: saved.profile,
      currentRepresentation: saved.currentRepresentation,
    }),
  );
}
