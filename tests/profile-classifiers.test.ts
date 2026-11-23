import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSIFIER_KINDS } from "../assets/shared/classifiers";
import { readClassifierResult } from "../functions/_lib/services/classifiers/results";
import type { Env } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { saveCheckSettings, sampleFlag } from "./helpers/classifier-settings";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  addRepresentative,
  assignRepresentativeRole,
  insertOrgRepresentative,
  insertOrganization,
  insertUser,
  REPRESENTATIVE_ROLE_IDS,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

type Questions = Record<string, { type: "noul" | "score"; criteria?: string[] }>;

/**
 * A stand-in check model that reads the whole state: "SPAMLINKS" is spam, "leading provider" is a biased claim,
 * and "Call for a discount" is promotion.
 */
const model = {
  run: vi.fn(async (_model: string, input: { state: unknown; questions: Questions }) => {
    const text = JSON.stringify(input.state);
    const raised = (id: string) =>
      (id === "spam" && text.includes("SPAMLINKS")) ||
      (id === "biased_claims" && text.includes("leading provider")) ||
      (id === "promotional" && text.includes("Call for a discount"));
    return {
      answers: Object.fromEntries(Object.keys(input.questions).map((id) => [id, { noul: raised(id) ? 0.97 : 0.02 }])),
    };
  }),
};
const checkedEnv = { ...env, AI: model } as unknown as Env;

/** Spam blocks; a biased claim or promotion only advises. Nothing is checked until settings are saved. */
async function saveProfileCheckSettings() {
  const flags = [
    sampleFlag("spam", "Looks like spam."),
    sampleFlag("biased_claims", "Describe what you do, not how you rank.", null),
    sampleFlag("promotional", "Leave out offers and sales wording.", null),
  ];
  await saveCheckSettings("organization_profile", flags);
  await saveCheckSettings("person_profile", flags);
}

function call(token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  return callApi(checkedEnv, path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

interface Refusal {
  error: { code: string; details: { fieldErrors: Record<string, string[]> } };
}

async function seedOrgContact() {
  const organizationId = await insertOrganization(env.DB, "Example Trust Services");
  const userId = await insertUser(env.DB, "contact@example.test");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "F");
  await addRepresentative(env.DB, memberId, userId);
  await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  return { organizationId, token: await createMemberSession(env.DB, userId, "org-contact-token") };
}

async function reviewCount(organizationId: string) {
  return (
    await queryAll<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM organization_content_reviews WHERE organization_id = ?",
      organizationId,
    )
  )[0]!.n;
}

describe("automatic checks of member pages", () => {
  beforeEach(async () => {
    await resetDb();
    await saveProfileCheckSettings();
    model.run.mockClear();
  });

  const path = (organizationId: string) => `/api/v1/organizations/${organizationId}/content/reviews`;

  it("refuses a page the check blocks, with the reason on the description", async () => {
    const { organizationId, token } = await seedOrgContact();
    const response = await call(token, path(organizationId), {
      method: "POST",
      body: { description: "Visit SPAMLINKS today" },
    });
    expect(response.status).toBe(422);
    const refusal = await response.json<Refusal>();
    expect(refusal.error.code).toBe("PROFILE_CHECK_BLOCKED");
    expect(refusal.error.details.fieldErrors.description?.[0]).toContain("spam");
    expect(await reviewCount(organizationId)).toBe(0);
  });

  it("advises first, then queues the page as written and shows its verdict to staff", async () => {
    const { organizationId, token } = await seedOrgContact();
    const body = { description: "We are the leading provider of certificates." };
    const advised = await call(token, path(organizationId), { method: "POST", body });
    expect(advised.status).toBe(422);
    expect((await advised.json<Refusal>()).error.code).toBe("PROFILE_CHECK_ADVICE");
    expect(await reviewCount(organizationId)).toBe(0);

    const submitted = await call(token, path(organizationId), {
      method: "POST",
      body: { ...body, adviceAcknowledged: true },
    });
    expect(submitted.status, await submitted.clone().text()).toBe(200);
    const { review } = await submitted.json<{ review: { id: string } }>();
    const stored = await readClassifierResult(env.DB, "organization_profile", review.id);
    expect(stored?.outcome).toBe("advised");
    expect(stored?.flags.map((flag) => flag.id)).toEqual(["biased_claims"]);

    const { admin } = await seedEventAndAdmin(env.DB);
    const adminToken = await createAdminSession(env.DB, admin.id, "admin-profile-checks");
    const detail = await call(adminToken, `/api/v1/organizations/content-reviews/${review.id}`);
    expect(detail.status, await detail.clone().text()).toBe(200);
    expect(
      (await detail.json<{ review: { automaticReview: { outcome: string } } }>()).review.automaticReview.outcome,
    ).toBe("advised");
  });

  it("queues the page unchecked when the model fails", async () => {
    model.run.mockRejectedValueOnce(new Error("model unavailable"));
    const { organizationId, token } = await seedOrgContact();
    const response = await call(token, path(organizationId), {
      method: "POST",
      body: { description: "A plain text." },
    });
    expect(response.status).toBe(200);
    const { review } = await response.json<{ review: { id: string } }>();
    expect(await readClassifierResult(env.DB, "organization_profile", review.id)).toMatchObject({
      outcome: "unchecked",
    });
  });

  it("puts the reasons on the first changed field", async () => {
    const { organizationId, token } = await seedOrgContact();
    const both = await call(token, path(organizationId), {
      method: "POST",
      body: { slogan: "Certificates", description: "Visit SPAMLINKS today" },
    });
    expect((await both.json<Refusal>()).error.details.fieldErrors.slogan?.[0]).toContain("spam");
    const page = await call(token, path(organizationId), {
      method: "POST",
      body: { contentMarkdown: "Visit SPAMLINKS today" },
    });
    expect((await page.json<Refusal>()).error.details.fieldErrors.contentMarkdown?.[0]).toContain("spam");
  });

  it("makes no model call for links alone", async () => {
    const { organizationId, token } = await seedOrgContact();
    const response = await call(token, path(organizationId), {
      method: "POST",
      body: { website: "https://example.com/" },
    });
    expect(response.status).toBe(200);
    expect(model.run).not.toHaveBeenCalled();
  });
});

describe("automatic checks of bios", () => {
  beforeEach(async () => {
    await resetDb();
    await saveProfileCheckSettings();
    model.run.mockClear();
  });

  async function owner() {
    const representative = await insertOrgRepresentative(env.DB, { email: "bio-owner@example.test" });
    const token = await createMemberSession(env.DB, representative.userId, "bio-owner-token");
    return { ...representative, token, path: `/api/v1/users/current/identities/${representative.identityId}/profile` };
  }

  it("refuses a bio the check blocks, with the reason on the biography", async () => {
    const { token, path, identityId } = await owner();
    const response = await call(token, path, {
      method: "PATCH",
      body: { jobTitle: "Engineer", biography: "SPAMLINKS everywhere" },
    });
    expect(response.status).toBe(422);
    const refusal = await response.json<Refusal>();
    expect(refusal.error.code).toBe("PROFILE_CHECK_BLOCKED");
    expect(refusal.error.details.fieldErrors.biography?.[0]).toContain("spam");
    expect(await readClassifierResult(env.DB, "person_profile", identityId)).toBeNull();
  });

  it("advises first, then saves as written and keeps the verdict", async () => {
    const { token, path, identityId } = await owner();
    const body = { jobTitle: "Engineer", biography: "Call for a discount on our product." };
    const advised = await call(token, path, { method: "PATCH", body });
    expect(advised.status).toBe(422);
    expect((await advised.json<Refusal>()).error.code).toBe("PROFILE_CHECK_ADVICE");

    const saved = await call(token, path, { method: "PATCH", body: { ...body, adviceAcknowledged: true } });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await readClassifierResult(env.DB, "person_profile", identityId)).toMatchObject({ outcome: "advised" });
  });

  it("saves unchecked when the model fails, and the current-user edit is checked too", async () => {
    const { token, path, identityId } = await owner();
    model.run.mockRejectedValueOnce(new Error("model unavailable"));
    const saved = await call(token, path, {
      method: "PATCH",
      body: { jobTitle: "Engineer", biography: "An engineer." },
    });
    expect(saved.status).toBe(200);
    expect(await readClassifierResult(env.DB, "person_profile", identityId)).toMatchObject({ outcome: "unchecked" });

    const blocked = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: { jobTitle: "Engineer", biography: "SPAMLINKS" },
    });
    expect(blocked.status).toBe(422);
    expect((await blocked.json<Refusal>()).error.code).toBe("PROFILE_CHECK_BLOCKED");
  });

  it("drops the verdict of the old text when the changed text is not checked", async () => {
    const { token, path, identityId } = await owner();
    const body = { jobTitle: "Engineer", biography: "An engineer." };
    expect((await call(token, path, { method: "PATCH", body })).status).toBe(200);
    expect(await readClassifierResult(env.DB, "person_profile", identityId)).toMatchObject({ outcome: "passed" });
    // No model binding: the new text is saved unchecked, and the old verdict no longer describes it.
    const unchecked = await callApi(env, path, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, biography: "A different bio." }),
    });
    expect(unchecked.status).toBe(200);
    expect(await readClassifierResult(env.DB, "person_profile", identityId)).toBeNull();
  });

  it("makes no model call when the bio and title do not change", async () => {
    const { token, path } = await owner();
    expect(
      (await call(token, path, { method: "PATCH", body: { jobTitle: "Engineer", biography: "An engineer." } })).status,
    ).toBe(200);
    model.run.mockClear();
    const same = await call(token, path, {
      method: "PATCH",
      body: { jobTitle: "Engineer", biography: "An engineer.", links: [] },
    });
    expect(same.status).toBe(200);
    expect(model.run).not.toHaveBeenCalled();
  });
});

describe("profile checks stay PKIC-wide", () => {
  beforeEach(resetDb);

  it("lists the member page and bio checks, and refuses them as event additions", async () => {
    const { admin } = await seedEventAndAdmin(env.DB);
    const adminToken = await createAdminSession(env.DB, admin.id, "admin-wide-checks");
    const list = await call(adminToken, "/api/v1/classifiers");
    expect(list.status).toBe(200);
    expect((await list.json<{ checks: { kind: string }[] }>()).checks.map((check) => check.kind)).toEqual([
      ...CLASSIFIER_KINDS,
    ]);

    for (const kind of ["organization_profile", "person_profile"]) {
      const read = await call(adminToken, `/api/v1/events/pqc-2026/classifiers/${kind}`);
      expect(read.status).toBe(400);
      const write = await call(adminToken, `/api/v1/events/pqc-2026/classifiers/${kind}`, {
        method: "PUT",
        body: { expectedRevision: 0, context: "", questions: [], disabledQuestionIds: [] },
      });
      expect(write.status).toBe(400);
    }
    expect((await call(adminToken, "/api/v1/events/pqc-2026/classifiers/proposal")).status).toBe(200);
  });
});
