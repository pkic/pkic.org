/** @covers groups.8.9 */
import { expect, test } from "@playwright/test";
import {
  groupDetailResponseSchema,
  groupLeadershipAssignSchema,
  groupLeadershipListResponseSchema,
  groupLeadershipUpdateSchema,
} from "../../assets/shared/schemas/groups";
import { groupDirectoryResponseSchema } from "../../assets/shared/schemas/group-directory";
import { userUpdateSchema } from "../../assets/shared/schemas/user-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";
import { publishE2eSite } from "./helpers/site-publication";

for (const role of [
  { roleId: "role-group_lead", title: "Chair", name: "Example Forum Chair" },
  { roleId: "role-group_deputy_lead", title: "Vice Chair", name: "Example Forum Deputy" },
] as const)
  test(
    `the About page publishes the pkic forum with only a ${role.title} for anonymous visitors`,
    { tag: "@publication" },
    async ({ page, browser }) => {
      test.setTimeout(240_000);
      await signInToPortal(page, e2eAdminEmail());
      const forumId = "20000000-0000-4000-8000-000000000001";
      const userRoleIds: string[] = [];
      const configured = groupDetailResponseSchema.parse(
        await (await page.request.get(`/api/v1/groups/${forumId}`)).json(),
      );
      expect(configured.group.slug).toBe("pkic");
      try {
        const names = [role.name];
        for (const name of names) {
          const member = await createMember(page);
          const renamed = await page.request.patch(`/api/v1/users/${member.userId}`, {
            data: userUpdateSchema.parse({ firstName: name, lastName: null }),
          });
          expect(renamed.status()).toBe(200);
          const assigned = await page.request.post(`/api/v1/groups/${forumId}/leadership`, {
            data: groupLeadershipAssignSchema.parse({
              userId: member.userId,
              identityId: member.identityId,
              roleId: role.roleId,
              title: role.title,
              startsAt: "2026-03-01T00:00:00.000Z",
            }),
          });
          expect(assigned.ok(), await assigned.text()).toBe(true);
          const assignment = groupLeadershipListResponseSchema
            .parse(await assigned.json())
            .assignments.find((entry) => entry.userId === member.userId && entry.identityId === member.identityId);
          expect(assignment).toBeDefined();
          userRoleIds.push(assignment!.userRoleId);
        }
        await publishE2eSite(page, "/about/");
        const anonymous = await browser.newContext();
        try {
          const visitor = await anonymous.newPage();
          const url = new URL("/about/", page.url()).href;
          const directoryResponse = await anonymous.request.get(
            new URL(`/api/v1/groups/${forumId}/directory`, url).href,
          );
          expect(directoryResponse.status()).toBe(200);
          const directory = groupDirectoryResponseSchema.parse(await directoryResponse.json());
          expect(directory.roster).toBeNull();
          expect(directory.leadership.map((entry) => entry.person.name)).toEqual(names);
          expect(directory.leadership.map((entry) => entry.roleId)).toEqual([role.roleId]);
          // The public page's first paint must not depend on a directory request.
          await visitor.route("**/api/**", (route) => route.abort());
          await visitor.goto(url);
          for (const width of [1440, 390]) {
            await visitor.setViewportSize({ width, height: 1000 });
            await expect(visitor.locator('[data-positions="current"] .person-card')).toHaveCount(1);
            for (const name of names) {
              await expect(
                visitor.locator('[data-positions="current"] .person-card').filter({ hasText: name }),
              ).toBeVisible();
            }
            await expect
              .poll(() => visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
              .toBe(true);
            await visitor.screenshot({ path: test.info().outputPath(`about-forum-${width}.png`), fullPage: true });
          }
        } finally {
          await anonymous.close();
        }
      } finally {
        // Attempt every cleanup even if one term cannot be ended.
        const ended = await Promise.allSettled(
          userRoleIds.map(async (userRoleId) => {
            const response = await page.request.patch(`/api/v1/groups/${forumId}/leadership/${userRoleId}`, {
              data: groupLeadershipUpdateSchema.parse({ endsAt: new Date(Date.now() - 60_000).toISOString() }),
            });
            expect(response.ok(), await response.text()).toBe(true);
          }),
        );
        expect(ended.filter((result) => result.status === "rejected")).toEqual([]);
      }
    },
  );
