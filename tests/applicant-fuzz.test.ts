/**
 * No applicant name, however odd, may break an application or leave it without its account decision.
 *
 * Seeded names (letters of many scripts, punctuation the account rules refuse, long runs) apply for
 * membership through the real route. Each must be accepted, or refused with a 4xx that names the
 * problem, never a 500. An applicant whose name the account rules accept can sign in afterwards.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { callApi } from "./helpers/app";
import { pick, pieces, seededRandom } from "./helpers/fuzz";
import {
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";

const apiEnv = () =>
  ({
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(1000),
    EMAIL_RATE_LIMITER: createTestRateLimiter(1000),
  }) as typeof env;

const NAME_PARTS = [
  "Alice",
  "José",
  "O'Brien",
  "Anne-Marie",
  "van der Berg",
  "Łukasz",
  "Ōtani",
  "Ahmed",
  "李",
  "Мария",
  "D'Souza",
  "Jr.",
];
const ODD_PARTS = [
  "+",
  ":",
  "@",
  "<b>",
  "&",
  "'; DROP TABLE users;--",
  "​",
  "‮",
  "\t",
  "😀",
  "%00",
  "{{x}}",
  "\\",
  "/",
  "*",
];

function fuzzName(random: () => number): string {
  const base = pieces(random, NAME_PARTS, 1, 4, " ");
  switch (Math.floor(random() * 4)) {
    case 0:
      return base;
    case 1:
      return `${base} ${pick(random, ODD_PARTS)}`;
    case 2:
      return `${pick(random, ODD_PARTS)}${base}`;
    default:
      return pieces(random, NAME_PARTS, 20, 40, " ").slice(0, 160);
  }
}

describe.each([11, 22, 33])("applicant names (seed %i)", (seed) => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("never fail an application and never leave a half-made account", async () => {
    const random = seededRandom(seed);
    const failures: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const applicantName = fuzzName(random).trim() || "Alice";
      const email = `fuzz-${seed}-${index}@fuzz-individual.test`;
      const response = await callApi(apiEnv(), "/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          await verifiedMemberApplicationPayload({
            applicantEmail: email,
            applicantName,
            membershipCategory: "H6",
            answers: { reason: "Fuzz.", ...requiredMembershipApplicationAnswers },
          }),
        ),
      });
      if (response.status >= 500) failures.push(`#${index} ${JSON.stringify(applicantName)} -> ${response.status}`);
      if (response.status !== 201) continue;
      const users = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [email]);
      const [application] = await queryAll<{ applicant_user_id: string | null }>(
        env.DB,
        "SELECT applicant_user_id FROM member_applications WHERE applicant_email = ?",
        [email],
      );
      // Either the account exists and the application points at it, or neither does.
      if (users.length > 1) failures.push(`#${index} duplicate accounts for ${JSON.stringify(applicantName)}`);
      if ((users[0]?.id ?? null) !== (application?.applicant_user_id ?? null))
        failures.push(`#${index} application/account mismatch for ${JSON.stringify(applicantName)}`);
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });
});
