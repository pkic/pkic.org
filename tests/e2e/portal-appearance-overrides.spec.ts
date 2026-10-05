import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { agendaSnapshotSchema, agendaOccurrenceCreateSchema } from "../../assets/shared/schemas/event-agenda";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { appearanceOverridesResponseSchema } from "../../assets/shared/schemas/event-appearance-overrides";
const slug = "pqc-conference-amsterdam-nl";
test("historical display correction requires an independent reviewer and stays in the draft", async ({
  page,
  browser,
}) => {
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  const user = userAuthSessionResponseSchema.parse(
    await (await page.request.get("/api/v1/auth/session")).json(),
  ).identity;
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const title = "Reviewed historical representation";
  const create = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title,
      description: "An attributable historical representation",
      startAt: null,
      endAt: null,
      roomId: null,
      speakerUserIds: [user.id],
    }),
  });
  expect(create.status()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await create.json());
  const occurrence = snapshot.occurrences.find((r) => r.title === title)!;
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await page.getByRole("button", { name: "All sessions", exact: true }).click();
  await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Session archive / materials", exact: true }).click();
  await page.getByLabel("Organization at this event", { exact: true }).fill("Historical employer from the program");
  await page.getByLabel("Override reason", { exact: true }).fill("Employer changed after this historical event");
  await page
    .getByLabel("Historical evidence", { exact: true })
    .fill("Archived program explicitly confirms the historical employer");
  await page.getByRole("button", { name: "Request independent review", exact: true }).click();
  const endpoint = `/api/v1/events/${slug}/agenda/occurrences/${occurrence.id}/appearance-overrides`;
  await expect
    .poll(
      async () =>
        appearanceOverridesResponseSchema.parse(await (await page.request.get(endpoint)).json()).overrides.length,
    )
    .toBe(1);
  const request = appearanceOverridesResponseSchema.parse(await (await page.request.get(endpoint)).json())
    .overrides[0]!;
  expect(
    (
      await page.request.post(`${endpoint}/${request.id}/decisions`, {
        data: {
          expectedRevision: snapshot.revision,
          decision: "approved",
          reason: "Verified against the archived program",
        },
      })
    ).status(),
  ).toBe(403);
  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    await signInAsE2eStaff(reviewer, e2eAdminEmail("browser-auth"));
    await reviewer.goto(`/portal/#/events/${slug}/agenda`);
    await reviewer.getByRole("button", { name: "All sessions", exact: true }).click();
    await reviewer.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
    await reviewer.getByRole("menuitem", { name: "Session archive / materials", exact: true }).click();
    await reviewer.getByRole("button", { name: "Review override", exact: true }).click();
    await reviewer.getByLabel("Review reason", { exact: true }).fill("Verified against the archived program");
    const approvalResponse = reviewer.waitForResponse(
      (response) =>
        response.url().endsWith(`${endpoint}/${request.id}/decisions`) && response.request().method() === "POST",
    );
    await reviewer.getByRole("button", { name: "Record decision", exact: true }).click();
    const approval = await approvalResponse;
    expect(approval.status()).toBe(200);
    const result = await approval.json();
    expect(result.override.requestedBy).not.toBe(result.override.reviewedBy);
    expect(result.agenda.publishedRevision).toBe(snapshot.publishedRevision);
    expect(
      result.agenda.occurrences.find((r: { id: string }) => r.id === occurrence.id).history.appearances[0],
    ).toMatchObject({ userId: user.id, organizationName: "Historical employer from the program" });
  } finally {
    await reviewerContext.close();
  }
});
