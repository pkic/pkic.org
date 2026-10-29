/**
 * Whatever a person submits to their profile is stored as given or refused with a client error.
 *
 * Seeded names, titles, biographies and links, for an individual member and for a member of an
 * organization whose identity has no job title yet. A save never returns a 500, a successful one
 * reads back exactly what was sent (a biography is never HTML-escaped on its way through), and a
 * names-only save never trips the job-title rule.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { pick, pieces, seededRandom } from "./helpers/fuzz";

const NAMES = ["Alice", "José", "O'Brien", "Anne-Marie", "van der Berg", "Łukasz", "Ōtani", "李", "Мария", "D'Souza"];
const ODD = ["+", ":", "@", "<b>", "&", "&amp;", "​", "\t", "😀", "{{x}}", "\\", "*", "_", "`", "<script>x</script>"];
const PROSE = [
  "Research & development",
  "R&D",
  "Q&A",
  "50% of",
  "a<b",
  "x > y",
  '"quoted"',
  "it's",
  "naïve",
  "漢字",
  "😀",
  "**bold**",
  "[link](https://example.test)",
];

function name(random: () => number): string {
  const base = pieces(random, NAMES, 1, 2, " ");
  return random() < 0.5 ? base : `${base}${pick(random, ODD)}`;
}

function biography(random: () => number): string {
  return pieces(random, PROSE, 1, 12, random() < 0.5 ? " " : "\n\n");
}

describe.each([5, 6, 7])("profile saves (seed %i)", (seed) => {
  beforeEach(resetDb);

  it("an individual member's names and biography", async () => {
    const person = await insertIndividualMember(env.DB, "H6");
    const token = await createMemberSession(env.DB, person.userId, `fuzz-individual-${seed}`);
    const random = seededRandom(seed);
    const failures: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const body = { firstName: name(random), lastName: name(random), biography: biography(random) };
      const response = await callApi(env, "/api/v1/users/current", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status >= 500) failures.push(`#${index} ${JSON.stringify(body)} -> ${response.status}`);
      if (response.status === 200) {
        const saved = (await response.json()) as { biography: string | null };
        if ((saved.biography ?? "") !== body.biography.trim())
          failures.push(
            `#${index} biography changed: ${JSON.stringify(body.biography)} -> ${JSON.stringify(saved.biography)}`,
          );
      }
    }
    expect(failures.slice(0, 6)).toEqual([]);
  });

  it("a representative without a job title can always rename themselves", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB, `Fuzz Org ${seed}`);
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    await addRepresentative(env.DB, memberId, userId, { jobTitle: null });
    const token = await createMemberSession(env.DB, userId, `fuzz-rep-${seed}`);
    const random = seededRandom(seed * 7);
    const failures: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const body = { firstName: name(random), lastName: name(random) };
      const response = await callApi(env, "/api/v1/users/current", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.clone().text();
      if (response.status >= 500) failures.push(`#${index} ${JSON.stringify(body)} -> ${response.status}`);
      if (response.status === 400 && text.includes("job title"))
        failures.push(`#${index} names-only save asked for a job title: ${JSON.stringify(body)}`);
    }
    expect(failures.slice(0, 6)).toEqual([]);
  });
});
