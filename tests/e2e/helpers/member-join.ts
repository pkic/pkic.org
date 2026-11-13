import { expect, type Page } from "@playwright/test";
import { memberJoinVerifyResponseSchema, memberJoinVerifySchema } from "../../../assets/shared/schemas/member-join";
import { signedInRequest, signInThroughCard } from "./sign-in-card";

/**
 * Signs the applicant in the way the join page's sign-in card does (starting
 * their account when the address is new) and returns the membership path the
 * server decides for that session. The applicant gets a session of their own,
 * so whoever is signed in on `page` stays signed in. This is shared by E2E
 * fixtures so no test bypasses the boundary the UI uses.
 */
export async function verifyMembershipJoinEmail(
  page: Page,
  email: string,
  options: { unaffiliatedAttestation?: boolean; organizationName?: string } = {},
) {
  const unaffiliatedAttestation = options.unaffiliatedAttestation ?? false;
  const applicant = await signedInRequest(new URL(page.url()).origin, email, { individual: unaffiliatedAttestation });
  try {
    const decide = async (selection: { organizationId?: string } = {}) => {
      const verified = await applicant.post("/api/v1/members/join/verify", {
        data: memberJoinVerifySchema.parse({ unaffiliatedAttestation, ...selection }),
      });
      expect(verified.status(), await verified.text()).toBe(200);
      return memberJoinVerifyResponseSchema.parse(await verified.json());
    };
    const path = await decide();
    // A person on a claimed domain says which of its organizations they represent, as the page asks them to.
    if (path.status !== "organization_selection_required" || !options.organizationName) return path;
    const chosen = path.organizations.find((organization) => organization.name === options.organizationName);
    if (!chosen) throw new Error(`"${options.organizationName}" is not offered for ${email}`);
    return await decide({ organizationId: chosen.id });
  } finally {
    await applicant.dispose();
  }
}

/**
 * Opens the join page as a signed-out visitor, signs them in through its
 * sign-in card (starting an account for a new address), and answers "How are
 * you joining?". Leaves the page on whatever the server decides for that path.
 */
export async function startJoinInBrowser(
  page: Page,
  email: string,
  options: { individual?: boolean } = {},
): Promise<void> {
  await page.goto("/join/");
  await signInThroughCard(page, email, { emailFlow: "join", individual: options.individual });
  await chooseJoinPath(page, options.individual ? "individual" : "organization");
}

/** Answers "How are you joining?" for a signed-in person who represents no organization yet. */
export async function chooseJoinPath(page: Page, path: "organization" | "individual"): Promise<void> {
  const choice = page.getByRole("radiogroup", { name: "How are you joining?", exact: true });
  await expect(choice).toBeVisible({ timeout: 30_000 });
  await choice
    .getByRole("radio", { name: path === "individual" ? "As an individual" : "For my organization", exact: true })
    .check();
}
