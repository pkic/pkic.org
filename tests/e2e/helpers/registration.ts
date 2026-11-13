import { expect, type Locator, type Page } from "@playwright/test";
import { addMissingName } from "./person-details";
import { EMAIL_FIRST_COPY, ORGANIZATION_JOB_TITLE_COPY } from "../../../assets/shared/email-first-copy";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../../assets/shared/schemas/registration";
import { uniqueSuffix } from "./membership";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { signInThroughCard } from "./sign-in-card";

const REGISTRATION_PAGE = "/events/2026/pqc-conference-amsterdam-nl/register/";
const REGISTRATION_API = "/api/v1/events/pqc-conference-amsterdam-nl/registrations";

/** The organization to register on behalf of, and hooks into each step of the wizard. */
export interface RegistrationOrganization {
  organization?: string;
  jobTitle?: string;
  /** The identity dialog is asking which organization the signed-in address represents. */
  onOrganizationReady?: (page: Page, dialog: Locator) => Promise<void>;
  onContactReady?: (page: Page) => Promise<void>;
  onReviewReady?: (page: Page) => Promise<void>;
  onAttendanceReady?: (page: Page) => Promise<void>;
  onProfileReady?: (page: Page) => Promise<void>;
}

/**
 * Answers the organization question inside `scope` when the form asks it. Pass
 * the name for an address whose domain may name no organization yet; without
 * one, the form must ask nothing.
 */
async function answerOrganization(page: Page, scope: Page | Locator, values: RegistrationOrganization): Promise<void> {
  const chooser = scope.getByRole("combobox", { name: /^Organization/ });
  if (values.organization) {
    const matching = chooser.getByRole("option", { name: values.organization, exact: true });
    const name = scope.getByRole("textbox", { name: /^Organization name/ });
    if (await name.isVisible()) await name.fill(values.organization);
    else if ((await chooser.count()) && (await matching.count()))
      await chooser.selectOption({ label: values.organization });
    else {
      await scope.getByRole("button", { name: "Add organization", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add organization", exact: true });
      await dialog.getByRole("textbox", { name: /^Organization name/ }).fill(values.organization);
      await dialog.getByRole("button", { name: "Use organization", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  }
  const title = scope.getByRole("textbox", { name: ORGANIZATION_JOB_TITLE_COPY.label });
  if (await title.count()) await title.fill(values.jobTitle ?? "Conference attendee");
}

/**
 * Chooses the representation a signed-in person registers as, through the
 * contact step's identity picker: one they already hold whose label carries
 * `organization`, or a new one added there from the address they signed in with.
 */
async function chooseRepresentation(
  page: Page,
  values: { email: string; organization: string } & RegistrationOrganization,
): Promise<void> {
  const contact = page.locator("[data-registration-contact]");
  await contact.getByRole("button", { name: "Change representation", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Change representation", exact: true });
  const picker = chooser.getByRole("combobox", { name: "Representation", exact: true });
  await picker.click();
  const listed = page.getByRole("listbox", { name: "Your identities" });
  // The picker lists the organization identities the person holds, or says there are none.
  await expect(
    listed
      .getByRole("option")
      .or(chooser.getByText("No matches.", { exact: true }))
      .first(),
  ).toBeVisible();
  const held = listed.getByRole("option").filter({ hasText: values.organization });
  if (await held.count()) await held.first().click();
  else {
    await page.keyboard.press("Escape");
    await chooser.getByRole("button", { name: "Add identity", exact: true }).click();
    const adding = page.getByRole("dialog", { name: "Add identity", exact: true });
    // The address is the account's own, proved at sign-in: nothing is emailed again.
    await adding.getByLabel(EMAIL_FIRST_COPY.representation.work.label, { exact: true }).fill(values.email);
    await adding.getByRole("button", { name: "Continue", exact: true }).click();
    const add = adding.getByRole("button", { name: "Add representation", exact: true });
    await expect(add).toBeVisible();
    await values.onOrganizationReady?.(page, adding);
    await answerOrganization(page, adding, values);
    await add.click();
    await expect(adding).not.toBeVisible();
  }
  await expect(picker).toContainText(values.organization);
  await chooser.getByRole("button", { name: "Use representation", exact: true }).click();
  await expect(chooser).not.toBeVisible();
  await expect(contact).toContainText(values.organization);
}

/**
 * The registration's first step. A signed-out visitor signs in through the
 * shared card (starting an account when the address is new) and returns to the
 * form; a person already signed in continues at once. A new account then gives
 * its name, and `organization` chooses the representation to register as.
 * Leaves the wizard on step 2.
 */
export async function continueRegistrationWithEmail(
  page: Page,
  values: {
    email: string;
    firstName?: string;
    lastName?: string;
    individual?: boolean;
    returning?: boolean;
  } & RegistrationOrganization,
): Promise<void> {
  const contact = page.locator("[data-registration-contact]");
  const card = page.locator("[data-registration-sign-in]").getByRole("region", { name: "Sign in", exact: true });
  const details = contact.getByText("Representation", { exact: true });
  await expect(card.or(details).first()).toBeVisible({ timeout: 30_000 });
  // A browser still signed in as an earlier registrant is a different visitor: they arrive signed out.
  if ((await details.isVisible()) && !(await contact.getByText(values.email, { exact: true }).count())) {
    await page.context().clearCookies();
    await page.reload();
    await expect(card).toBeVisible({ timeout: 30_000 });
  }
  if (await card.isVisible())
    await signInThroughCard(page, values.email, {
      individual: values.individual,
      returning: values.returning,
      emailFlow: "registration",
    });
  await expect(details).toBeVisible({ timeout: 30_000 });
  await expect(contact).toContainText(values.email);
  await addMissingName(page, contact, values);
  if (values.organization) await chooseRepresentation(page, { ...values, organization: values.organization });
  await values.onContactReady?.(page);
  await page.locator("[data-event-registration] [data-step-next]").click();
}

/**
 * A work address on a domain no other journey uses. A domain becomes an
 * organization's once someone verifies with it, so a shared one would make
 * whether the form asks for an organization depend on which journey ran first.
 */
export function ownDomainEmail(local: string): string {
  return `${local}@${local}-${uniqueSuffix()}.test`;
}

/**
 * Confirms a registration that waited for email confirmation (one submitted
 * without a verified address) on the open confirmation page. A work address
 * whose domain names no organization is asked for one, and the job title held
 * there, first: pass the name for such an address, and leave it out for one
 * whose domain already decides.
 */
export async function confirmRegistration(
  page: Page,
  organization?: string,
  jobTitle = "Conference attendee",
): Promise<void> {
  const confirm = page.getByRole("button", { name: /Confirm my registration/i });
  await expect(confirm).toBeVisible();
  await answerOrganization(page, page, { organization, jobTitle });
  await confirm.click();
}

/**
 * Registers in the browser as the person behind `email`, signing them in
 * through the card first when the browser has no session, and returns the
 * result with the request as a reusable template. `identityName` names the
 * representation to register as: one they hold, or a new organization.
 */
export async function registerInBrowser(
  page: Page,
  email: string,
  identityName?: string,
  entryUrl = REGISTRATION_PAGE,
  options: { individual?: boolean; returning?: boolean; attendanceLabel?: string } & RegistrationOrganization = {},
) {
  await page.goto(entryUrl);
  await continueRegistrationWithEmail(page, {
    email,
    ...options,
    organization: identityName ?? options.organization,
  });
  await options.onAttendanceReady?.(page);
  if (options.attendanceLabel) {
    await page
      .getByRole("button", { name: `Choose ${options.attendanceLabel} for every available day`, exact: true })
      .click();
  } else {
    await page.getByRole("button", { name: /^Choose On[- ]demand for every available day$/ }).click();
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await options.onProfileReady?.(page);
  await page.getByLabel("Country", { exact: true }).selectOption("US");
  // Organization belongs to the shared contact/representation flow, not the additional profile questions.
  await expect(page.locator('[data-step-panel="3"]').getByLabel("Organization", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await options.onReviewReady?.(page);
  for (const term of [/privacy policy/i, /code of conduct/i, /photos and videos/i]) {
    await page.getByRole("checkbox", { name: term }).check();
  }
  const since = await capturedEmailCount();
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === REGISTRATION_API && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(200);
  // The chosen identity belongs to this person alone, so it is left out of the reusable request.
  const { identityId, ...request } = registrationCreateSchema.parse(response.request().postDataJSON());
  return {
    result: registrationSubmissionResponseSchema.parse(await response.json()),
    request,
    identityId,
    /** A signed-in person's management link arrives by email only; it is not shown on the page. */
    manageLink: async () => {
      const confirmed = await waitForCapturedEmail(email, "registration is confirmed", { since });
      const manageUrl = extractEmailUrl(confirmed, "/register/manage/");
      const manageToken = new URL(manageUrl).searchParams.get("token");
      if (!manageToken) throw new Error("The confirmation email must carry the registration management link");
      return { manageUrl, manageToken };
    },
  };
}
