/** @covers vote.5.12 */
import { expect, test } from "@playwright/test";
import {
  authenticatedGroupDetailResponseSchema,
  groupUpdateSchema,
  groupJoinSchema,
} from "../../assets/shared/schemas/groups";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

for (const conversion of ["endorsement", "approval"] as const) {
  test(`a participant proposal leads to its new vote after ${conversion}`, async ({ page, browser }) => {
    await signInToPortal(page, e2eAdminEmail("portal-vote-window"));
    const groupUrl = `/api/v1/groups/${GROUP_ID}`;
    const original = authenticatedGroupDetailResponseSchema.parse(
      await (await page.request.get(groupUrl)).json(),
    ).configuration!;
    async function setThreshold(count: number) {
      const current = authenticatedGroupDetailResponseSchema.parse(
        await (await page.request.get(groupUrl)).json(),
      ).configuration!;
      const updated = await page.request.patch(groupUrl, {
        data: groupUpdateSchema.parse({ expectedRevision: current.revision, minEndorsersForBallot: count }),
      });
      expect(updated.status(), await updated.text()).toBe(200);
    }
    const member = await createMember(page);
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      await setThreshold(conversion === "endorsement" ? 1 : 2);
      const participant = await context.newPage();
      await signInToPortal(participant, member.email);
      const joined = await participant.request.post(`${groupUrl}/join`, {
        data: groupJoinSchema.parse({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
      });
      expect(joined.status()).toBe(200);
      const votesRoute = `/portal/#/groups/${GROUP_ID}/votes`;
      await participant.goto(votesRoute);
      await tab(participant, "Proposals").click();
      await participant.getByRole("button", { name: "Propose a vote" }).click();
      const title = `Converted proposal ${conversion} ${Date.now()}`;
      const form = participant.getByRole("form", { name: "Propose a vote" });
      await form.getByLabel("Title").fill(title);
      await form.getByLabel("Description").fill("A participant request that reaches a usable ballot.");
      await form.getByRole("button", { name: "Submit proposal" }).click();
      await expect(participant).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/votes/proposals$`));
      // The row opens the proposal's own page (#126), never an expansion.
      await participant
        .getByRole("row")
        .filter({ hasText: title })
        .getByRole("link", { name: `Open ${title}` })
        .click();
      const detail = participant.getByRole("region", { name: title, exact: true });
      const endorsed = participant.waitForResponse(
        (response) => response.url().endsWith("/endorsement") && response.request().method() === "POST",
      );
      await detail.getByRole("button", { name: "Endorse", exact: true }).click();
      const response = await endorsed;
      expect(response.status()).toBe(200);
      let voteId: string;
      let destination = participant;
      if (conversion === "endorsement") {
        voteId = (await response.json()).convertedVote.id;
      } else {
        expect((await response.json()).convertedVote).toBeNull();
        await page.goto(votesRoute);
        await tab(page, "Proposals").click();
        await expect(page.getByText("You are not participating in this group", { exact: false })).toBeVisible();
        await expect(page.getByRole("button", { name: "Propose a vote" })).toHaveCount(0);
        await page
          .getByRole("row")
          .filter({ hasText: title })
          .getByRole("link", { name: `Open ${title}` })
          .click();
        const managed = page.getByRole("region", { name: title, exact: true });
        await expect(managed).toContainText("1 of 2 required endorsements");
        await managed.getByRole("button", { name: "Approve and create vote" }).click();
        const approved = page.waitForResponse(
          (result) => result.url().endsWith("/approve") && result.request().method() === "POST",
        );
        await acceptConfirmDialog(page, "Approve and create vote");
        const approvedResponse = await approved;
        expect(approvedResponse.status()).toBe(200);
        voteId = (await approvedResponse.json()).convertedVote.id;
        destination = page;
      }
      await expect(destination).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/votes/${voteId}$`));
      await expect(destination.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await destination.reload();
      await expect(destination.getByRole("heading", { name: title, exact: true })).toBeVisible();
    } finally {
      await setThreshold(original.minEndorsersForBallot);
      await context.close();
    }
  });
}
