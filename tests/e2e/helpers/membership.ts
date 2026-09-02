import { expect, type Page } from "@playwright/test";
import { verifyMembershipJoinEmail } from "./member-join";

/**
 * Public membership-application provisioning for browser journeys.
 *
 * Every application is created the way an applicant creates one: through the
 * mailbox-verified join capability. Nothing here shortcuts the verification
 * boundary, so a test can never assert on state a real applicant could not
 * have produced. Stage movement is deliberately NOT included — the journeys
 * that care about stages drive them through the portal UI.
 */
export interface SubmittedApplication {
  applicationId: string;
  email: string;
  name: string;
  organizationName?: string;
  category: string;
}

/**
 * A relative `fetch` inside `page.evaluate` needs a real origin, and a fresh
 * page starts on `about:blank`. Callers should not have to remember that.
 */
export async function ensureAppOrigin(page: Page): Promise<void> {
  if (!page.url().startsWith("http")) await page.goto("/");
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** Submits one application and returns its identifier. */
export async function submitMembershipApplication(
  page: Page,
  options: {
    email: string;
    name: string;
    category: string;
    organizationName?: string;
    unaffiliatedAttestation?: boolean;
  },
): Promise<SubmittedApplication> {
  await ensureAppOrigin(page);
  const join = await verifyMembershipJoinEmail(page, options.email, {
    unaffiliatedAttestation: options.unaffiliatedAttestation ?? false,
  });
  expect(join.status, "the applicant must reach an application, not organization access").toBe("application_ready");
  if (join.status !== "application_ready") throw new Error("Expected an application continuation");

  const created = await page.evaluate(
    async ({ email, name, category, organizationName, joinToken }) => {
      const response = await fetch("/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail: email,
          applicantName: name,
          membershipCategory: category,
          ...(organizationName ? { organizationName } : {}),
          joinToken,
          answers: {
            reason: "This browser journey exercises the membership review workflow.",
            agrees_bylaws: true,
            agrees_code_of_conduct: true,
            agrees_ipr_policy: true,
            warranted_authority: true,
          },
        }),
      });
      return { status: response.status, body: (await response.json()) as { applicationId?: string } };
    },
    {
      email: options.email,
      name: options.name,
      category: options.category,
      organizationName: options.organizationName,
      joinToken: join.joinToken,
    },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return {
    applicationId: created.body.applicationId!,
    email: options.email,
    name: options.name,
    ...(options.organizationName ? { organizationName: options.organizationName } : {}),
    category: options.category,
  };
}

/**
 * Opens one application's detail view from the Membership list, narrowed to
 * a stage through the Stage column's menu. The menu names stages the way the
 * badge does ("EC review" for `ec_review`), so the key is matched as words,
 * case-insensitively, rather than through an option value.
 */
export async function openApplicationDetail(page: Page, email: string, stage: string): Promise<void> {
  await page.goto("/portal/#/membership/applications");
  await expect(page.getByRole("heading", { name: "Membership" })).toBeVisible();
  await page.getByRole("button", { name: "Stage column options" }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${stage.replace(/_/g, " ")}$`, "i") }).click();
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
}

/**
 * The stage badge rendered beside the applicant name in the detail header.
 *
 * The header is found through the applicant's `<h2>`, which is a role and a
 * name rather than the four Bootstrap utility classes that used to be on the
 * wrapper — those went when the detail view adopted the design system, and a
 * selector written that way breaks again at the next migration.
 */
export function stageBadge(page: Page, applicantName: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: applicantName, level: 2 }) })
    .last()
    .locator("span.pk-badge");
}

/** The stage-transition card, by the name its region announces. */
export function transitionCard(page: Page) {
  return page.getByRole("region", { name: "Stage transition" });
}

/**
 * Moves an application one stage through the portal UI rather than the API,
 * so the control that staff actually use is the thing under test.
 */
export async function transitionStageInUi(
  page: Page,
  toStage: string,
  options: { onHoldSubtype?: string; note?: string } = {},
): Promise<void> {
  const card = transitionCard(page);
  await expect(card).toBeVisible();
  const moveTo = card.locator("select").first();
  await moveTo.selectOption(toStage);
  if (toStage === "on_hold" && options.onHoldSubtype) {
    await card.locator("select").nth(1).selectOption(options.onHoldSubtype);
  }
  // Located by the name the field announces rather than by a control class:
  // the note has a real `for`/`id` pair now, so the spec can use it.
  if (options.note) await card.getByLabel("Note").fill(options.note);

  const response = page.waitForResponse(
    (r) =>
      /\/api\/v1\/members\/applications\/[^/]+\/stage$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "PATCH",
  );
  await card.getByRole("button", { name: "Transition" }).click();
  expect((await response).status(), `transition to ${toStage}`).toBe(200);
}

/**
 * Takes one applicant all the way to an approved member, returning the
 * identifiers later journeys need.
 *
 * The caller must already hold a staff session with membership write and
 * approve permissions: the stage moves and the approval are staff actions, and
 * routing them through the API here keeps the journey that *uses* the member
 * focused on its own subject rather than re-testing the review workflow, which
 * `membership-application-stages.spec.ts` covers through the UI.
 */
export async function approveMemberThroughReview(
  page: Page,
  options: { email: string; name: string; organizationName?: string; category?: string },
): Promise<{ email: string; userId: string; applicationId: string }> {
  const application = await submitMembershipApplication(page, {
    email: options.email,
    name: options.name,
    category: options.category ?? "F",
    ...(options.organizationName ? { organizationName: options.organizationName } : {}),
  });

  for (const toStage of ["in_review", "in_consultation", "ec_review"]) {
    const status = await page.evaluate(
      async ({ applicationId, toStage }) => {
        const response = await fetch(`/api/v1/members/applications/${applicationId}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ toStage }),
        });
        return response.status;
      },
      { applicationId: application.applicationId, toStage },
    );
    expect(status, `stage transition to ${toStage}`).toBe(200);
  }

  const approved = await page.evaluate(async (applicationId) => {
    const response = await fetch(`/api/v1/members/applications/${applicationId}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    return { status: response.status, body: (await response.json()) as { userId: string } };
  }, application.applicationId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  return { email: options.email, userId: approved.body.userId, applicationId: application.applicationId };
}

/** The exact approved identities the signed-in person may currently act through. */
export async function readActiveIdentities(
  page: Page,
): Promise<Array<{ identityId: string; memberId: string; organizationName: string | null }>> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users/current", { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as {
        activeIdentities: Array<{ identityId: string; memberId: string; organizationName: string | null }>;
      },
    };
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.activeIdentities;
}
