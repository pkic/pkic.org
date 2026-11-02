import { expect, type Page } from "@playwright/test";
import { EMAIL_FIRST_COPY, ORGANIZATION_JOB_TITLE_COPY } from "../../../assets/shared/email-first-copy";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../../assets/shared/schemas/registration";
import { uniqueSuffix } from "./membership";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

const REGISTRATION_PAGE = "/events/2026/pqc-conference-amsterdam-nl/register/";
const REGISTRATION_API = "/api/v1/events/pqc-conference-amsterdam-nl/registrations";

const copy = EMAIL_FIRST_COPY.registration;

/** The organization a verified work address names when its domain names none yet, asked in the first step. */
export interface RegistrationOrganization {
  organization?: string;
  jobTitle?: string;
  onContactReady?: (page: Page) => Promise<void>;
  onReviewReady?: (page: Page) => Promise<void>;
  onAttendanceReady?: (page: Page) => Promise<void>;
  onProfileReady?: (page: Page) => Promise<void>;
}

/**
 * Answers the organization question when the form asks it. Pass the name for
 * an address whose domain may name no organization yet; without one, the
 * form must ask nothing.
 */
async function answerOrganization(page: Page, values: RegistrationOrganization): Promise<void> {
  const chooser = page.getByRole("combobox", { name: /^Organization/ });
  if (values.organization) {
    const matching = chooser.getByRole("option", { name: values.organization, exact: true });
    const name = page.getByRole("textbox", { name: /^Organization name/ });
    if (await name.isVisible()) await name.fill(values.organization);
    else if ((await chooser.count()) && (await matching.count()))
      await chooser.selectOption({ label: values.organization });
    else {
      await page.getByRole("button", { name: "Add organization", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add organization", exact: true });
      await dialog.getByRole("textbox", { name: /^Organization name/ }).fill(values.organization);
      await dialog.getByRole("button", { name: "Use organization", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  }
  const title = page.getByRole("textbox", { name: ORGANIZATION_JOB_TITLE_COPY.label });
  if (await title.count()) await title.fill(values.jobTitle ?? "Conference attendee");
}

/**
 * The registration's first step: the email, verified through the link it
 * sends, then — for a person not already known by it — their name and, for a
 * work domain that names no organization yet, the organization. The link
 * opens the form again with the address verified. Leaves the wizard on step 2.
 */
export async function continueRegistrationWithEmail(
  page: Page,
  values: { email: string; firstName?: string; lastName?: string; individual?: boolean } & RegistrationOrganization,
): Promise<void> {
  const contact = page.locator("[data-registration-contact]");
  const choice = values.individual ? copy.personal : copy.work;
  if (values.individual) await contact.getByRole("radio", { name: copy.personal.title, exact: true }).check();
  await contact.getByLabel(choice.label).fill(values.email);
  const since = await capturedEmailCount();
  await contact.getByRole("button", { name: choice.action, exact: true }).click();
  const sent = contact.getByText(copy.sent(values.email), { exact: true });
  const next = page.locator("[data-event-registration] [data-step-next]");
  // A person signed in with this address has nothing to verify and continues at once.
  await expect.poll(async () => (await sent.isVisible()) || (await next.isVisible())).toBe(true);
  if (await sent.isVisible()) {
    const verification = await waitForCapturedEmail(values.email, "Verify your email", { since });
    await page.goto(extractEmailUrl(verification, "#verify="));
  }
  await expect(next).toBeVisible();
  if ((await contact.getByLabel("First name").count()) > 0) {
    await contact.getByLabel("First name").fill(values.firstName ?? "Event");
    await contact.getByLabel("Last name").fill(values.lastName ?? "Attendee");
  }
  await answerOrganization(page, values);
  await values.onContactReady?.(page);
  await next.click();
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
  await answerOrganization(page, { organization, jobTitle });
  await confirm.click();
}

/**
 * Registers in the browser, verified first, and returns the result with the
 * request as a reusable template: the proof and the organization belong to
 * this address alone, so they are left out of it.
 */
export async function registerInBrowser(
  page: Page,
  email: string,
  identityName?: string,
  entryUrl = REGISTRATION_PAGE,
  options: { individual?: boolean } & RegistrationOrganization = {},
) {
  await page.goto(entryUrl);
  if (identityName) {
    // A signed-in person has nothing to verify: they continue with their saved details and the identity under that mail domain.
    const contact = page.locator("[data-registration-contact]");
    await contact.getByLabel(copy.work.label).fill(email);
    await contact.getByRole("button", { name: copy.work.action, exact: true }).click();
    await expect(contact.getByText("Representation", { exact: true })).toBeVisible();
    const change = contact.getByRole("button", { name: "Change representation", exact: true });
    if (await change.count()) {
      await change.click();
      const chooser = page.getByRole("dialog", { name: "Change representation", exact: true });
      const picker = chooser.getByRole("combobox", { name: "Representation", exact: true });
      await picker.click();
      await page.getByRole("option").filter({ hasText: identityName }).click();
      await chooser.getByRole("button", { name: "Use representation", exact: true }).click();
      await expect(chooser).not.toBeVisible();
    } else {
      await expect(contact).toContainText(identityName);
    }
    await page.locator("[data-event-registration] [data-step-next]").click();
  } else {
    await continueRegistrationWithEmail(page, { email, ...options });
  }
  await options.onAttendanceReady?.(page);
  await page.getByRole("button", { name: /^Choose On[- ]demand for every available day$/ }).click();
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
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === REGISTRATION_API && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(200);
  const { emailProof, organization, ...request } = registrationCreateSchema.parse(response.request().postDataJSON());
  return {
    result: registrationSubmissionResponseSchema.parse(await response.json()),
    request,
    verified: { emailProof, organization },
  };
}
