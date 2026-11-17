import { expect, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";
import { ACCOUNT_ORGANIZATION_COPY } from "../../../assets/shared/account-organization-copy";
import { EMAIL_FIRST_ADVISORY_COPY, ORGANIZATION_JOB_TITLE_COPY } from "../../../assets/shared/email-first-copy";
import {
  userAuthEstablishedResponseSchema,
  userAuthVerifyResponseSchema,
  userAuthVerifySchema,
} from "../../../assets/shared/schemas/user-auth";

/**
 * How a test person answers account setup's organization step, which a work
 * address without an organization meets when its link is opened. Without an
 * organization the address is used as a personal one, which only a domain no
 * organization has claimed allows.
 */
export interface AccountOrganizationChoice {
  organization?: {
    name: string;
    jobTitle?: string;
    /** The email domain the organization uses, when the address offers its parent or a subdomain. */
    domain?: string;
    /**
     * Looks at the filled-in choice before it is confirmed: the step itself,
     * or the "Add organization" dialog when the organization is new beside others.
     */
    inspect?: (scope: Locator) => Promise<void>;
  };
}

const DEFAULT_JOB_TITLE = "Representative";

function requestTo(page: Page, path: string) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "POST",
    { timeout: 60_000 },
  );
}

/**
 * Answers the step on screen when the opened link asked for it, and returns
 * the verify response that carries the session.
 */
export async function answerAccountOrganizationStep(
  page: Page,
  verified: Response,
  choice: AccountOrganizationChoice = {},
): Promise<Response> {
  expect(verified.status()).toBe(200);
  // A link that signs straight in leaves the page at once, and its body with it: nothing was asked.
  const body: unknown = await verified.json().catch(() => null);
  if (body === null) return verified;
  const result = userAuthVerifyResponseSchema.parse(body);
  if (!("organizationRequired" in result)) return verified;
  const step = page.getByRole("region", { name: ACCOUNT_ORGANIZATION_COPY.title, exact: true });
  await expect(step).toBeVisible({ timeout: 15_000 });
  const organization = choice.organization;
  if (!organization) {
    expect(result.organizationRequired.personalAllowed, "a claimed domain needs an organization").toBe(true);
    const answered = requestTo(page, "/api/v1/auth/verify-link");
    await step.getByRole("button", { name: EMAIL_FIRST_ADVISORY_COPY.usePersonal, exact: true }).click();
    return answered;
  }
  const { organizations } = result.organizationRequired.affiliation;
  const listed = organizations.find((item) => item.name === organization.name);
  // A required field's label carries its marker, so labels are matched from their start.
  const chooseDomain = async (scope: Locator) => {
    const domain = scope.getByLabel(/^Email domain/);
    if (organization.domain && (await domain.isVisible())) await domain.selectOption(organization.domain);
  };
  if (listed) {
    await chooseDomain(step);
    await step.getByLabel(/^Organization\b(?! name)/).selectOption(listed.id);
    await organization.inspect?.(step);
  } else if (organizations.length > 0) {
    // Beside the organizations already known, a new one is added through its dialog.
    await step.getByRole("button", { name: "Add organization", exact: true }).click();
    const adding = page.getByRole("dialog", { name: "Add organization", exact: true });
    const name = adding.getByLabel(/^Organization name/);
    await expect(name).toBeVisible();
    await chooseDomain(adding);
    await name.fill(organization.name);
    await organization.inspect?.(adding);
    await adding.getByRole("button", { name: "Use organization", exact: true }).click();
    await expect(adding).toBeHidden();
  } else {
    await chooseDomain(step);
    await step.getByLabel(/^Organization name/).fill(organization.name);
    await organization.inspect?.(step);
  }
  const jobTitle = step.getByLabel(new RegExp(`^${ORGANIZATION_JOB_TITLE_COPY.label}`));
  if (await jobTitle.isVisible()) await jobTitle.fill(organization.jobTitle ?? DEFAULT_JOB_TITLE);
  const prepared = requestTo(page, "/api/v1/auth/verify-link");
  await step.getByRole("button", { name: ACCOUNT_ORGANIZATION_COPY.finish, exact: true }).click();
  // The first request prepares the selection; the second answers the step with it.
  expect((await prepared).status()).toBe(200);
  // The answer signs the person in and the page moves on, so only its status is read here.
  const answered = await requestTo(page, "/api/v1/auth/verify-link");
  expect(answered.status()).toBe(200);
  return answered;
}

/** The same answer without a browser: redeems `token` on `context` and returns its session. */
export async function redeemSignInLink(
  context: APIRequestContext,
  token: string,
  choice: AccountOrganizationChoice = {},
) {
  const verify = async (body: Omit<Parameters<typeof userAuthVerifySchema.parse>[0], "token">) => {
    const response = await context.post("/api/v1/auth/verify-link", {
      data: userAuthVerifySchema.parse({ token, ...(body as object) }),
    });
    expect(response.status(), await response.text()).toBe(200);
    return userAuthVerifyResponseSchema.parse(await response.json());
  };
  const opened = await verify({});
  if (!("organizationRequired" in opened)) return opened;
  const organization = choice.organization;
  if (!organization) {
    expect(opened.organizationRequired.personalAllowed, "a claimed domain needs an organization").toBe(true);
    return userAuthEstablishedResponseSchema.parse(await verify({ organization: { personal: true } }));
  }
  const listed = opened.organizationRequired.affiliation.organizations.find((item) => item.name === organization.name);
  const prepared = await verify({
    affiliation: {
      selection: {
        ...(organization.domain ? { domain: organization.domain } : {}),
        organizationId: listed?.id ?? null,
        ...(listed ? {} : { organizationName: organization.name }),
        jobTitle: listed?.jobTitle ?? organization.jobTitle ?? DEFAULT_JOB_TITLE,
      },
    },
  });
  if (!("organizationRequired" in prepared) || !prepared.organizationRequired.affiliation.contextToken)
    throw new Error("The organization selection was not prepared");
  return userAuthEstablishedResponseSchema.parse(
    await verify({ organization: { contextToken: prepared.organizationRequired.affiliation.contextToken } }),
  );
}
