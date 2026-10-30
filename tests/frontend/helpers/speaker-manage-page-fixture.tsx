import { expect, vi } from "vitest";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { EventSpeakerManagement } from "../../../assets/ts/site/EventSpeakerManagement";
import { speakerProfileUpdateResponseSchema } from "../../../assets/shared/schemas/speaker-self-service";
import { identitiesListResponseSchema } from "../../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { userDetailResponseSchema } from "../../../assets/shared/schemas/user-management";
import { EMAIL_FIRST_COPY } from "../../../assets/shared/email-first-copy";
import { completeIndependentCapacityDisclosure } from "./independent-capacity";

export const READ = "/api/v1/proposals/speakers/access/speaker-token-12345678901234567890";
export const TERMS = "/api/v1/events/pqc-2026/terms";
export const SPEAKER_USER_ID = "00000000-0000-4000-8000-000000000041";
/** The speaker's individual identity, which an individual selection speaks as. */
export const INDIVIDUAL_IDENTITY_ID = "00000000-0000-4000-8000-000000000061";
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

const buttonLabeled = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("button")).find((button) => button.textContent === label);

/** For a signed-in speaker, once their saved details have loaded. */
export async function chooseIndividual(root: HTMLElement): Promise<void> {
  await vi.waitFor(() =>
    expect(
      root.querySelector('[role="combobox"]') ?? buttonLabeled(root, "Choose another representation"),
    ).toBeTruthy(),
  );
  if (!buttonLabeled(root, EMAIL_FIRST_COPY.speaker.individualSwitch!)) {
    await act(() => {
      buttonLabeled(root, "Choose another representation")!.click();
    });
  }
  await act(() => {
    buttonLabeled(root, EMAIL_FIRST_COPY.speaker.individualSwitch!)!.click();
  });
  await completeIndependentCapacityDisclosure(root);
}

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function speakerPage(
  overrides: { status?: string; proposalStatus?: string; personalDetailsEditable?: boolean } = {},
): Record<string, unknown> {
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
      personalDetailsEditable: overrides.personalDetailsEditable ?? true,
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
  // Settle the real lazy editor dependency before a case can unmount or reset modules.
  // The loading indicator below tracks the page request, not this component import.
  await import("../../../assets/ts/components/markdown-editor/MarkdownEditor");
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

/** Canonical saved selection receipt, independent of the recorded appearance; `page` shapes the default page. */
export function profileReceipt(data?: Record<string, unknown>, page: Parameters<typeof speakerPage>[0] = {}): Response {
  const saved = data ?? speakerPage(page);
  if (!data) {
    const selectedAt = "2026-01-01T00:00:00.000Z";
    saved.profile = {
      ...(saved.profile as Record<string, unknown>),
      actingIdentitySelection: "individual",
      actingIdentitySelectedAt: selectedAt,
    };
    saved.currentRepresentation = {
      identityId: INDIVIDUAL_IDENTITY_ID,
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
