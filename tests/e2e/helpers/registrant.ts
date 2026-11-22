import { expect, type Page } from "@playwright/test";
import { emailDomainOf, emailDomainResponseSchema, emailDomainUrl } from "../../../assets/shared/schemas/email-domains";
import {
  currentUserIdentityCreateSchema,
  identityMutationResponseSchema,
} from "../../../assets/shared/schemas/identity";
import {
  identityAffiliationPreviewResponseSchema,
  identityAffiliationPreviewSchema,
} from "../../../assets/shared/schemas/identity-affiliation";
import { myProfileSchema, myProfileUpdateSchema } from "../../../assets/shared/schemas/me";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../../assets/shared/schemas/registration";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { USER_SESSION_COOKIE_NAME } from "../../../functions/_lib/auth/session-cookies";
import { clientIpForIdentity } from "./portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { signInRequestContext } from "./sign-in-card";

type RegistrationBody = ReturnType<typeof registrationCreateSchema.parse>;

export interface RegistrantOptions {
  /** The account's names, which every registration shows; saved when given, or when the account has none. */
  firstName?: string;
  lastName?: string;
  /** The organization identity to register as, already held; skips resolving one. */
  identityId?: string;
  /** The organization name a work address names when its domain decides none yet. */
  organization?: string;
  jobTitle?: string;
}

/**
 * Signs the browser behind `page` in as `email` through the account's own
 * mailbox capability, the only way a person can register, and returns the
 * organization identity a work address registers as. A session already held
 * for this address is kept; any other is replaced, since the registrant is a
 * different person. The account's names come from the profile, never the
 * registration body, so missing or different names are saved there first.
 */
export async function signInAsRegistrant(
  page: Page,
  email: string,
  options: RegistrantOptions = {},
): Promise<{ identityId?: string; individual: boolean }> {
  // Independent people arrive from independent clients; see `signInToPortal`.
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  const domainResponse = await page.request.get(emailDomainUrl(emailDomainOf(email)));
  expect(domainResponse.status(), await domainResponse.text()).toBe(200);
  const { kind } = emailDomainResponseSchema.parse(await domainResponse.json());
  const individual = kind === "free";
  const current = await page.request.get("/api/v1/auth/session");
  const held =
    current.status() === 200 &&
    userAuthSessionResponseSchema.parse(await current.json()).identity.email === email.trim().toLowerCase();
  if (!held) {
    await page.context().clearCookies({ name: USER_SESSION_COOKIE_NAME });
    await signInRequestContext(page.request, email, { individual });
  }
  await saveNames(page, options);
  if (options.identityId || kind !== "work") return { identityId: options.identityId, individual };
  return { identityId: await organizationIdentity(page, email, options), individual };
}

/**
 * Registers the person behind `body.email` with `body`, signing them in first,
 * and returns the registration with the management link its confirmation
 * email carries, the only place that link is given. As on the server, the
 * body's names are not the registrant's: pass `firstName`/`lastName` to save
 * them on the account.
 */
export async function registerSignedIn(
  page: Page,
  eventSlug: string,
  body: RegistrationBody,
  options: RegistrantOptions = {},
) {
  const { identityId, individual } = await signInAsRegistrant(page, body.email, {
    ...options,
    identityId: options.identityId ?? body.identityId,
  });
  const since = await capturedEmailCount();
  const submitted = await page.request.post(`/api/v1/events/${eventSlug}/registrations`, {
    // A personal mailbox takes part as an individual, as the form's personal choice says.
    data: registrationCreateSchema.parse({ ...body, identityId, unaffiliatedAttestation: individual }),
  });
  expect(submitted.status(), await submitted.text()).toBe(200);
  const result = registrationSubmissionResponseSchema.parse(await submitted.json());
  const confirmed = await waitForCapturedEmail(body.email, "registration is confirmed", { since });
  const manageUrl = extractEmailUrl(confirmed, "/register/manage/");
  const manageToken = new URL(manageUrl).searchParams.get("token");
  if (!manageToken) throw new Error("The confirmation email must carry the registration management link");
  return { result, identityId, manageUrl, manageToken };
}

async function saveNames(page: Page, options: RegistrantOptions) {
  const profileResponse = await page.request.get("/api/v1/users/current");
  expect(profileResponse.status(), await profileResponse.text()).toBe(200);
  const profile = myProfileSchema.parse(await profileResponse.json());
  const firstName = options.firstName ?? profile.firstName ?? "Synthetic";
  const lastName = options.lastName ?? profile.lastName ?? "Attendee";
  if (profile.firstName === firstName && profile.lastName === lastName) return;
  const saved = await page.request.patch("/api/v1/users/current", {
    data: myProfileUpdateSchema.parse({ firstName, lastName }),
  });
  expect(saved.status(), await saved.text()).toBe(200);
}

/** The organization identity the work address speaks for: one already held, or one added from that address. */
async function organizationIdentity(page: Page, email: string, options: RegistrantOptions): Promise<string> {
  const preview = async (body: unknown) => {
    const response = await page.request.post("/api/v1/users/current/identities/preview", {
      data: identityAffiliationPreviewSchema.parse(body),
    });
    expect(response.status(), await response.text()).toBe(200);
    return identityAffiliationPreviewResponseSchema.parse(await response.json());
  };
  const resolved = await preview({ phase: "resolve", email, emailId: null });
  const owned = resolved.organizations.filter((organization) => organization.identityId);
  const chosen = owned.find((organization) => organization.name === options.organization) ?? owned[0];
  if (chosen?.identityId) return chosen.identityId;
  const organizationId = resolved.organization?.id ?? resolved.organizations[0]?.id ?? null;
  const prepared = await preview({
    phase: "prepare",
    email,
    emailId: null,
    organizationId,
    ...(organizationId ? {} : { organizationName: options.organization ?? `Synthetic ${resolved.domain}` }),
    jobTitle: options.jobTitle ?? "Conference attendee",
  });
  if (prepared.identityId) return prepared.identityId;
  if (!prepared.contextToken) throw new Error("The prepared representation must carry its verified context");
  const created = await page.request.post("/api/v1/users/current/identities", {
    data: currentUserIdentityCreateSchema.parse({ contextToken: prepared.contextToken }),
  });
  expect(created.status(), await created.text()).toBe(201);
  return identityMutationResponseSchema.parse(await created.json()).identityId;
}
