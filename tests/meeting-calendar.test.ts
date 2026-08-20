/**
 * meeting-calendar.test.ts
 *
 * meeting_series/meeting_ics_files/
 * member_meeting_preferences, the WG-nested and consortium admin CRUD
 * surfaces, the public working-group meetings list, member self-service
 * (/me/calendar), and the two auto-trigger hooks (application-approved-
 * welcome ICS attachments, wg-calendar-invite resolution for the Google
 * Groups sync pass). Mirrors working-groups.test.ts's setup/auth pattern.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission } from "./helpers/member-applications";
import {
  resolveWgJoinCalendarInviteByMailingListEmail,
  uploadIcsFile,
  deleteIcsFile,
  deleteMeetingSeries,
} from "../functions/_lib/services/meeting-calendar";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { isIndividualMembershipCategory } from "../assets/shared/schemas/membership-categories";
import { insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callMultipart(token: string, path: string, formData: FormData): Promise<Response> {
  const req = new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData,
  });
  return app.fetch(req, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function insertMember(userId: string, category: string, organizationId: string | null = null): Promise<void> {
  if (isIndividualMembershipCategory(category)) {
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, category, new Date().toISOString());
    await env.DB.batch(statements);
    return;
  }
  const orgId = organizationId ?? (await insertOrganization(env.DB));
  const memberId = await seedOrganizationAggregate(env.DB, orgId, category);
  await addRepresentative(env.DB, memberId, userId);
}

async function insertWorkingGroup(name: string, slug: string, mailingListEmail: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, slug, mailingListEmail)
    .run();
  return id;
}

async function insertWgMembership(wgId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at)
     VALUES (?, ?, ?, datetime('now'), NULL)`,
  )
    .bind(crypto.randomUUID(), wgId, userId)
    .run();
}

async function insertMeetingSeries(
  scopeType: "consortium" | "working_group",
  name: string,
  workingGroupId: string | null = null,
  active = 1,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, scopeType, workingGroupId, active)
    .run();
  return id;
}

async function insertIcsFile(
  seriesId: string,
  label: string,
  year: number,
  r2Key: string,
  active = 1,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO meeting_ics_files (id, series_id, label, year, r2_key, active, uploaded_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, datetime('now'))`,
  )
    .bind(id, seriesId, label, year, r2Key, active)
    .run();
  return id;
}

async function insertPreference(userId: string, seriesId: string, icsFileId: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO member_meeting_preferences (id, user_id, series_id, ics_file_id, set_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, seriesId, icsFileId)
    .run();
}

async function assignContextualRole(
  userId: string,
  roleId: string,
  contextType: string,
  contextId: string,
  grantedBy: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, contextType, contextId, grantedBy)
    .run();
}

describe("Meeting calendar management", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-meetings-token");
  });

  // ── Admin: WG-nested meeting series ─────────────────────────────────────

  it("creates a WG meeting series, uploads an ICS file variant, and lists it back", async () => {
    const wgId = await insertWorkingGroup("Test PQC", "test-pqc");

    const createResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/meetings`, {
      method: "POST",
      body: JSON.stringify({ name: "PQC WG Meeting" }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { meetingSeries: { id: string } };

    const file = new File([new TextEncoder().encode("BEGIN:VCALENDAR\nEND:VCALENDAR")], "invite.ics", {
      type: "text/calendar",
    });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", "09:00 CET");
    formData.append("year", "2026");

    const uploadResponse = await callMultipart(
      adminToken,
      `/api/v1/admin/working-groups/${wgId}/meetings/${created.meetingSeries.id}/ics-files`,
      formData,
    );
    expect(uploadResponse.status).toBe(201);
    const uploaded = (await uploadResponse.json()) as { icsFile: { id: string; label: string; r2Key: string } };
    expect(uploaded.icsFile.label).toBe("09:00 CET");

    const stored = await env.ASSETS_BUCKET!.get(uploaded.icsFile.r2Key);
    expect(stored).toBeTruthy();
    expect(await stored!.text()).toContain("BEGIN:VCALENDAR");

    const listResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/meetings`);
    const list = (await listResponse.json()) as {
      meetingSeries: Array<{ id: string; icsFiles: Array<{ id: string }> }>;
    };
    const series = list.meetingSeries.find((s) => s.id === created.meetingSeries.id);
    expect(series?.icsFiles.some((f) => f.id === uploaded.icsFile.id)).toBe(true);
  });

  it("rejects a file whose bytes are not an iCalendar document", async () => {
    const wgId = await insertWorkingGroup("Unsafe ICS", "unsafe-ics");
    const seriesId = await insertMeetingSeries("working_group", "Unsafe Upload", wgId);
    const formData = new FormData();
    formData.append("file", new File(["<script>alert(1)</script>"], "calendar.ics", { type: "text/calendar" }));
    formData.append("label", "Unsafe");
    formData.append("year", "2026");

    const response = await callMultipart(
      adminToken,
      `/api/v1/admin/working-groups/${wgId}/meetings/${seriesId}/ics-files`,
      formData,
    );
    expect(response.status).toBe(400);
    expect(await env.ASSETS_BUCKET!.list({ prefix: `meeting-ics/${seriesId}/` })).toMatchObject({ objects: [] });
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE series_id = ?", seriesId)).toHaveLength(0);
  });

  it("deactivating an ICS file is non-destructive and clears any member preference pointing at it", async () => {
    const wgId = await insertWorkingGroup("PQC", "pqc");
    const seriesId = await insertMeetingSeries("working_group", "PQC WG Meeting", wgId);
    const fileId = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/f1.ics");
    const memberUserId = await insertUser("wg-pref@example.test");
    await insertMember(memberUserId, "F");
    await insertWgMembership(wgId, memberUserId);
    await insertPreference(memberUserId, seriesId, fileId);

    const patchResponse = await call(
      adminToken,
      `/api/v1/admin/working-groups/${wgId}/meetings/${seriesId}/ics-files/${fileId}`,
      { method: "PATCH", body: JSON.stringify({ active: false }) },
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { icsFile: { active: boolean } };
    expect(patched.icsFile.active).toBe(false);

    // R2 object retained (non-destructive) — deactivation is DB-only.
    await env.ASSETS_BUCKET!.put("meeting-ics/f1.ics", "still here");
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/f1.ics")).toBeTruthy();

    const prefRows = await queryAll<{ ics_file_id: string | null }>(
      env.DB,
      "SELECT ics_file_id FROM member_meeting_preferences WHERE user_id = ? AND series_id = ?",
      memberUserId,
      seriesId,
    );
    expect(prefRows[0].ics_file_id).toBeNull();
  });

  it("deletes an ICS file outright — removes the DB row, the R2 object, and clears any member preference", async () => {
    const wgId = await insertWorkingGroup("PQC Delete", "pqc-delete");
    const seriesId = await insertMeetingSeries("working_group", "PQC WG Meeting", wgId);
    const fileId = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/del1.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/del1.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");
    const memberUserId = await insertUser("wg-del-pref@example.test");
    await insertMember(memberUserId, "F");
    await insertWgMembership(wgId, memberUserId);
    await insertPreference(memberUserId, seriesId, fileId);

    const deleteResponse = await call(
      adminToken,
      `/api/v1/admin/working-groups/${wgId}/meetings/${seriesId}/ics-files/${fileId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);

    const remaining = await queryAll<{ id: string }>(env.DB, "SELECT id FROM meeting_ics_files WHERE id = ?", fileId);
    expect(remaining).toHaveLength(0);
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/del1.ics")).toBeNull();

    const prefRows = await queryAll<{ ics_file_id: string | null }>(
      env.DB,
      "SELECT ics_file_id FROM member_meeting_preferences WHERE user_id = ? AND series_id = ?",
      memberUserId,
      seriesId,
    );
    expect(prefRows[0].ics_file_id).toBeNull();
  });

  it("upload atomicity (PR #1 review §9.2): a D1 insert failure after a successful R2 put does not leave an orphaned object", async () => {
    const wgId = await insertWorkingGroup("PQC Orphan", "pqc-orphan");
    const seriesId = await insertMeetingSeries("working_group", "PQC WG Meeting", wgId);

    await expect(
      uploadIcsFile(
        env.DB,
        env.ASSETS_BUCKET!,
        seriesId,
        { scopeType: "working_group", workingGroupId: wgId },
        {
          label: "09:00 CET",
          year: 2026,
          buffer: new TextEncoder().encode("BEGIN:VCALENDAR\nEND:VCALENDAR").buffer,
          contentType: "text/calendar",
          // A syntactically valid but non-existent user id — violates
          // meeting_ics_files.uploaded_by_user_id's FK, forcing the D1
          // insert to fail after the R2 put has already succeeded.
          uploadedByUserId: "00000000-0000-4000-8000-000000000000",
        },
      ),
    ).rejects.toThrow();

    const remaining = await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE series_id = ?", seriesId);
    expect(remaining).toHaveLength(0);

    const listed = await env.ASSETS_BUCKET!.list({ prefix: `meeting-ics/${seriesId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it("delete atomicity (PR #1 review §9.2): an R2 delete failure leaves the D1 row intact so a retry can finish safely", async () => {
    const wgId = await insertWorkingGroup("PQC Retry", "pqc-retry");
    const seriesId = await insertMeetingSeries("working_group", "PQC WG Meeting", wgId);
    const fileId = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/retry.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/retry.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");

    const failingBucket = {
      delete: () => {
        throw new Error("simulated R2 outage");
      },
    } as unknown as R2Bucket;

    await expect(
      deleteIcsFile(env.DB, failingBucket, seriesId, fileId, { scopeType: "working_group", workingGroupId: wgId }),
    ).rejects.toThrow("simulated R2 outage");

    // The D1 row must still exist — a retry (with a healthy bucket) can find
    // it and finish the delete. The pre-fix ordering deleted the D1 row
    // first, which would have left this object unreachable by any retry.
    const stillThere = await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE id = ?", fileId);
    expect(stillThere).toHaveLength(1);
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/retry.ics")).toBeTruthy();

    const { r2Key } = await deleteIcsFile(env.DB, env.ASSETS_BUCKET!, seriesId, fileId, {
      scopeType: "working_group",
      workingGroupId: wgId,
    });
    expect(r2Key).toBe("meeting-ics/retry.ics");
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE id = ?", fileId)).toHaveLength(0);
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/retry.ics")).toBeNull();
  });

  it("cascading series delete atomicity (P9-R01, same pattern as PR #1 review §9.2): an R2 delete failure for any file in the series leaves every D1 row intact so the whole delete can be retried safely", async () => {
    const wgId = await insertWorkingGroup("PQC Series Retry", "pqc-series-retry");
    const seriesId = await insertMeetingSeries("working_group", "PQC WG Meeting", wgId);
    const fileId1 = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/series-retry-1.ics");
    await insertIcsFile(seriesId, "17:00 CET", 2026, "meeting-ics/series-retry-2.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/series-retry-1.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");
    await env.ASSETS_BUCKET!.put("meeting-ics/series-retry-2.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");
    const memberUserId = await insertUser("wg-series-retry-pref@example.test");
    await insertMember(memberUserId, "F");
    await insertWgMembership(wgId, memberUserId);
    await insertPreference(memberUserId, seriesId, fileId1);

    // Simulates a mid-cascade R2 outage: the first delete in the batch
    // succeeds, the second throws — mirroring a real partial R2 failure
    // across a *set* of objects rather than deleteIcsFile's single object.
    let calls = 0;
    const failingBucket = {
      delete: () => {
        calls += 1;
        if (calls > 1) throw new Error("simulated R2 outage");
        return Promise.resolve();
      },
    } as unknown as R2Bucket;

    await expect(
      deleteMeetingSeries(env.DB, failingBucket, seriesId, { scopeType: "working_group", workingGroupId: wgId }),
    ).rejects.toThrow("simulated R2 outage");

    // Because R2 objects are deleted BEFORE any D1 row in this cascade, a
    // failure partway through must leave every D1 row untouched — the
    // series, both ICS file rows, and the member preference — so a retry
    // can find the still-live rows and finish the job. The old D1-first
    // ordering deleted all `meeting_ics_files` rows up front and let a
    // partial R2 failure orphan whichever objects it missed, since no row
    // would reference them again afterward.
    expect(await queryAll(env.DB, "SELECT id FROM meeting_series WHERE id = ?", seriesId)).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE series_id = ?", seriesId)).toHaveLength(2);
    expect(
      await queryAll(env.DB, "SELECT id FROM member_meeting_preferences WHERE series_id = ?", seriesId),
    ).toHaveLength(1);

    // Retry with a healthy bucket: the whole cascade — both real R2
    // objects and every D1 row — finishes cleanly, proving the retry is
    // safe (R2Bucket#delete on an already-missing key is a no-op).
    const { deletedIcsFileR2Keys } = await deleteMeetingSeries(env.DB, env.ASSETS_BUCKET!, seriesId, {
      scopeType: "working_group",
      workingGroupId: wgId,
    });
    expect(deletedIcsFileR2Keys.sort()).toEqual(["meeting-ics/series-retry-1.ics", "meeting-ics/series-retry-2.ics"]);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_series WHERE id = ?", seriesId)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE series_id = ?", seriesId)).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM member_meeting_preferences WHERE series_id = ?", seriesId),
    ).toHaveLength(0);
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/series-retry-1.ics")).toBeNull();
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/series-retry-2.ics")).toBeNull();
  });

  it("deletes a whole meeting series — cascades to its ICS files, their R2 objects, and member preferences", async () => {
    const wgId = await insertWorkingGroup("CBOM Delete", "cbom-delete");
    const seriesId = await insertMeetingSeries("working_group", "CBOM WG Meeting", wgId);
    const fileId = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/series-del.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/series-del.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");
    const memberUserId = await insertUser("wg-series-del-pref@example.test");
    await insertMember(memberUserId, "F");
    await insertWgMembership(wgId, memberUserId);
    await insertPreference(memberUserId, seriesId, fileId);

    const deleteResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/meetings/${seriesId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    expect(await queryAll(env.DB, "SELECT id FROM meeting_series WHERE id = ?", seriesId)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE series_id = ?", seriesId)).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM member_meeting_preferences WHERE series_id = ?", seriesId),
    ).toHaveLength(0);
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/series-del.ics")).toBeNull();

    const listResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/meetings`);
    const list = (await listResponse.json()) as { meetingSeries: Array<{ id: string }> };
    expect(list.meetingSeries.some((s) => s.id === seriesId)).toBe(false);
  });

  it("deletes a consortium meeting series and a consortium ICS file", async () => {
    const seriesId = await insertMeetingSeries("consortium", "Main Consortium Meeting To Delete");
    const fileId = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/consortium-del.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/consortium-del.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");

    const otherFileId = await insertIcsFile(seriesId, "17:00 CET", 2026, "meeting-ics/consortium-del-2.ics");
    const fileDeleteResponse = await call(
      adminToken,
      `/api/v1/admin/consortium/meetings/${seriesId}/ics-files/${otherFileId}`,
      { method: "DELETE" },
    );
    expect(fileDeleteResponse.status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE id = ?", otherFileId)).toHaveLength(0);

    const seriesDeleteResponse = await call(adminToken, `/api/v1/admin/consortium/meetings/${seriesId}`, {
      method: "DELETE",
    });
    expect(seriesDeleteResponse.status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_series WHERE id = ?", seriesId)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_ics_files WHERE id = ?", fileId)).toHaveLength(0);
    expect(await env.ASSETS_BUCKET!.get("meeting-ics/consortium-del.ics")).toBeNull();
  });

  it("a WG chair can delete their own WG's meeting series but not another WG's", async () => {
    const ownWgId = await insertWorkingGroup("Own Delete WG", "own-delete-wg");
    const otherWgId = await insertWorkingGroup("Other Delete WG", "other-delete-wg");
    const ownSeriesId = await insertMeetingSeries("working_group", "Own Series", ownWgId);
    const otherSeriesId = await insertMeetingSeries("working_group", "Other Series", otherWgId);

    const chairUserId = await insertUser("wg-chair-delete@example.test");
    await assignContextualRole(chairUserId, "role-wg_chair", "working_group", ownWgId, adminId);
    const chairToken = await createAdminSession(env.DB, chairUserId, "wg-chair-delete-token");

    const otherResponse = await call(
      chairToken,
      `/api/v1/admin/working-groups/${otherWgId}/meetings/${otherSeriesId}`,
      { method: "DELETE" },
    );
    expect(otherResponse.status).toBe(403);

    const ownResponse = await call(chairToken, `/api/v1/admin/working-groups/${ownWgId}/meetings/${ownSeriesId}`, {
      method: "DELETE",
    });
    expect(ownResponse.status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM meeting_series WHERE id = ?", ownSeriesId)).toHaveLength(0);
  });

  it("resend smart-routes: a member with a still-active preference gets only that file, everyone else gets all active variants", async () => {
    const wgId = await insertWorkingGroup("CBOM", "cbom");
    const seriesId = await insertMeetingSeries("working_group", "CBOM WG Meeting", wgId);
    const fileA = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/a.ics");
    await insertIcsFile(seriesId, "17:00 CET", 2026, "meeting-ics/b.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/a.ics", "A");
    await env.ASSETS_BUCKET!.put("meeting-ics/b.ics", "B");

    const withPrefUserId = await insertUser("resend-pref@example.test");
    await insertMember(withPrefUserId, "F");
    await insertWgMembership(wgId, withPrefUserId);
    await insertPreference(withPrefUserId, seriesId, fileA);

    const noPrefUserId = await insertUser("resend-nopref@example.test");
    await insertMember(noPrefUserId, "F");
    await insertWgMembership(wgId, noPrefUserId);

    const resendResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/meetings/${seriesId}/resend`, {
      method: "POST",
    });
    expect(resendResponse.status).toBe(200);
    const resendBody = (await resendResponse.json()) as { queuedRecipients: number };
    expect(resendBody.queuedRecipients).toBe(2);

    const withPrefRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'calendar-invite-resend' AND recipient_user_id = ?",
        withPrefUserId,
      )
    )[0];
    const withPrefAttachments = JSON.parse(withPrefRow.payload_json).__attachments;
    expect(withPrefAttachments).toHaveLength(1);
    expect(withPrefAttachments[0].r2Key).toBe("meeting-ics/a.ics");

    const noPrefRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'calendar-invite-resend' AND recipient_user_id = ?",
        noPrefUserId,
      )
    )[0];
    const noPrefAttachments = JSON.parse(noPrefRow.payload_json).__attachments as Array<{ r2Key: string }>;
    expect(noPrefAttachments.map((a) => a.r2Key).sort()).toEqual(["meeting-ics/a.ics", "meeting-ics/b.ics"]);
  });

  it("a WG chair (context-scoped working-groups:write) can manage their own WG's meetings but not another WG's", async () => {
    const ownWgId = await insertWorkingGroup("Own WG", "own-wg");
    const otherWgId = await insertWorkingGroup("Other WG", "other-wg");
    const chairUserId = await insertUser("wg-chair@example.test");
    await assignContextualRole(chairUserId, "role-wg_chair", "working_group", ownWgId, adminId);
    const chairToken = await createAdminSession(env.DB, chairUserId, "wg-chair-token");

    const ownResponse = await call(chairToken, `/api/v1/admin/working-groups/${ownWgId}/meetings`, {
      method: "POST",
      body: JSON.stringify({ name: "Own Meeting" }),
    });
    expect(ownResponse.status).toBe(201);

    const otherResponse = await call(chairToken, `/api/v1/admin/working-groups/${otherWgId}/meetings`, {
      method: "POST",
      body: JSON.stringify({ name: "Should Not Be Created" }),
    });
    expect(otherResponse.status).toBe(403);
  });

  it("a staff user with no working-groups grant cannot create a WG meeting series", async () => {
    const wgId = await insertWorkingGroup("Locked WG", "locked-wg");
    const staffId = await insertUser("staff-no-meeting-perm@example.test");
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'role-membership_processor', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "staff-no-meeting-perm-token");

    const response = await call(staffToken, `/api/v1/admin/working-groups/${wgId}/meetings`, {
      method: "POST",
      body: JSON.stringify({ name: "Should Not Be Created" }),
    });
    expect(response.status).toBe(403);
  });

  // ── Admin: consortium meeting series ────────────────────────────────────

  it("creates and lists a consortium meeting series (admin)", async () => {
    const createResponse = await call(adminToken, "/api/v1/admin/consortium/meetings", {
      method: "POST",
      body: JSON.stringify({ name: "Main Consortium Meeting" }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { meetingSeries: { id: string; scopeType: string } };
    expect(created.meetingSeries.scopeType).toBe("consortium");

    const listResponse = await call(adminToken, "/api/v1/admin/consortium/meetings");
    const list = (await listResponse.json()) as { meetingSeries: Array<{ id: string }> };
    expect(list.meetingSeries.some((s) => s.id === created.meetingSeries.id)).toBe(true);
  });

  it("a WG chair's context-scoped grant does not authorize managing consortium meetings (staff admin only)", async () => {
    const wgId = await insertWorkingGroup("Ctx WG", "ctx-wg");
    const chairUserId = await insertUser("consortium-blocked-chair@example.test");
    await assignContextualRole(chairUserId, "role-wg_chair", "working_group", wgId, adminId);
    const chairToken = await createAdminSession(env.DB, chairUserId, "consortium-blocked-token");

    const response = await call(chairToken, "/api/v1/admin/consortium/meetings", {
      method: "POST",
      body: JSON.stringify({ name: "Should Not Be Created" }),
    });
    expect(response.status).toBe(403);
  });

  // ── Public ───────────────────────────────────────────────────────────────

  it("public GET /working-groups/:wgId/meetings returns only active series", async () => {
    const wgId = await insertWorkingGroup("Public WG", "public-wg");
    const activeSeriesId = await insertMeetingSeries("working_group", "Active Series", wgId, 1);
    await insertMeetingSeries("working_group", "Inactive Series", wgId, 0);

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/working-groups/${wgId}/meetings`),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { meetingSeries: Array<{ id: string; name: string }> };
    expect(body.meetingSeries).toHaveLength(1);
    expect(body.meetingSeries[0].id).toBe(activeSeriesId);
  });

  // ── Member self-service ──────────────────────────────────────────────────

  it("GET /me/calendar lists the consortium series plus my WG series, with my saved preference", async () => {
    const consortiumSeriesId = await insertMeetingSeries("consortium", "Main Consortium Meeting");
    await insertIcsFile(consortiumSeriesId, "09:00 CET", 2026, "meeting-ics/c1.ics");

    const wgId = await insertWorkingGroup("My WG", "my-wg");
    const wgSeriesId = await insertMeetingSeries("working_group", "My WG Meeting", wgId);
    const wgFileId = await insertIcsFile(wgSeriesId, "17:00 CET", 2026, "meeting-ics/w1.ics");

    const otherWgId = await insertWorkingGroup("Not My WG", "not-my-wg");
    await insertMeetingSeries("working_group", "Not My WG Meeting", otherWgId);

    const userId = await insertUser("calendar-member@example.test");
    await insertMember(userId, "F");
    await insertWgMembership(wgId, userId);
    await insertPreference(userId, wgSeriesId, wgFileId);
    const token = await createMemberSession(env.DB, userId, "calendar-member-token");

    const response = await call(token, "/api/v1/me/calendar");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      meetingSeries: Array<{ id: string; scopeType: string; preferenceIcsFileId: string | null }>;
    };
    expect(body.meetingSeries.map((s) => s.id).sort()).toEqual([consortiumSeriesId, wgSeriesId].sort());
    const wgEntry = body.meetingSeries.find((s) => s.id === wgSeriesId);
    expect(wgEntry?.preferenceIcsFileId).toBe(wgFileId);
  });

  it("PATCH preference sets and clears a preference, rejects a file not in the series, and rejects a WG I'm not a member of", async () => {
    const wgId = await insertWorkingGroup("Pref WG", "pref-wg");
    const seriesId = await insertMeetingSeries("working_group", "Pref WG Meeting", wgId);
    const fileId = await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/p1.ics");

    const otherSeriesId = await insertMeetingSeries("consortium", "Other Series");
    const otherFileId = await insertIcsFile(otherSeriesId, "10:00 CET", 2026, "meeting-ics/p2.ics");

    const userId = await insertUser("pref-member@example.test");
    await insertMember(userId, "F");
    await insertWgMembership(wgId, userId);
    const token = await createMemberSession(env.DB, userId, "pref-member-token");

    const setResponse = await call(token, `/api/v1/me/calendar/${seriesId}/preference`, {
      method: "PATCH",
      body: JSON.stringify({ icsFileId: fileId }),
    });
    expect(setResponse.status).toBe(200);

    const wrongFileResponse = await call(token, `/api/v1/me/calendar/${seriesId}/preference`, {
      method: "PATCH",
      body: JSON.stringify({ icsFileId: otherFileId }),
    });
    expect(wrongFileResponse.status).toBe(404);

    const clearResponse = await call(token, `/api/v1/me/calendar/${seriesId}/preference`, {
      method: "PATCH",
      body: JSON.stringify({ icsFileId: null }),
    });
    expect(clearResponse.status).toBe(200);
    const prefRows = await queryAll<{ ics_file_id: string | null }>(
      env.DB,
      "SELECT ics_file_id FROM member_meeting_preferences WHERE user_id = ? AND series_id = ?",
      userId,
      seriesId,
    );
    expect(prefRows[0].ics_file_id).toBeNull();

    const nonMemberWgId = await insertWorkingGroup("Not Mine", "not-mine");
    const nonMemberSeriesId = await insertMeetingSeries("working_group", "Not Mine Meeting", nonMemberWgId);
    const forbiddenResponse = await call(token, `/api/v1/me/calendar/${nonMemberSeriesId}/preference`, {
      method: "PATCH",
      body: JSON.stringify({ icsFileId: null }),
    });
    expect(forbiddenResponse.status).toBe(403);
  });

  it("GET download returns the ICS bytes with a calendar content type and attachment disposition", async () => {
    const consortiumSeriesId = await insertMeetingSeries("consortium", "Main Consortium Meeting");
    const fileId = await insertIcsFile(consortiumSeriesId, "09:00 CET", 2026, "meeting-ics/dl.ics");
    await env.ASSETS_BUCKET!.put("meeting-ics/dl.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR");

    const userId = await insertUser("download-member@example.test");
    await insertMember(userId, "F");
    const token = await createMemberSession(env.DB, userId, "download-member-token");

    const response = await call(token, `/api/v1/me/calendar/${consortiumSeriesId}/${fileId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  });

  it("rejects unauthenticated /me/calendar requests with 401", async () => {
    const response = await app.fetch(
      new Request("https://app.test/api/v1/me/calendar"),
      env as any,
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );
    expect(response.status).toBe(401);
  });

  // ── Hooks ────────────────────────────────────────────────────────────────

  it("approving an application attaches consortium + selected WG ICS files to the welcome email", async () => {
    const wgId = await insertWorkingGroup("pqc", "pqc", "pqc@lists.pkic.org");
    const consortiumSeriesId = await insertMeetingSeries("consortium", "Main Consortium Meeting");
    await insertIcsFile(consortiumSeriesId, "09:00 CET", 2026, "meeting-ics/approve-c.ics");
    const wgSeriesId = await insertMeetingSeries("working_group", "PQC WG Meeting", wgId);
    await insertIcsFile(wgSeriesId, "17:00 CET", 2026, "meeting-ics/approve-w.ics");

    const applicationId = crypto.randomUUID();
    const formSubmissionId = await createApplicationFormSubmission({ working_groups: ["pqc"] });
    await env.DB.prepare(
      `INSERT INTO member_applications
         (id, applicant_email, applicant_name, organization_name, organization_domain, membership_category,
          form_submission_id, status, stage, stage_entered_at, manage_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'F', ?, 'ec_review', 'ec_review', datetime('now'), ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        applicationId,
        "ics-approve@acme.test",
        "ICS Approve",
        "Acme ICS Corp",
        "acme-ics.test",
        formSubmissionId,
        crypto.randomUUID(),
      )
      .run();

    const response = await call(adminToken, `/api/v1/admin/applications/${applicationId}/approve`, {
      method: "POST",
    });
    expect(response.status).toBe(200);

    const welcomeRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'application-approved-welcome'",
      )
    )[0];
    const attachments = JSON.parse(welcomeRow.payload_json).__attachments as Array<{ r2Key: string }>;
    const r2Keys = attachments.map((a) => a.r2Key).sort();
    expect(r2Keys).toEqual(["meeting-ics/approve-c.ics", "meeting-ics/approve-w.ics"].sort());
  });

  it("resolveWgJoinCalendarInviteByMailingListEmail resolves a WG's active ICS files by mailing list email", async () => {
    const wgId = await insertWorkingGroup("tcwg", "tcwg", "tcwg@lists.pkic.org");
    const seriesId = await insertMeetingSeries("working_group", "TCWG Meeting", wgId);
    await insertIcsFile(seriesId, "09:00 CET", 2026, "meeting-ics/tcwg1.ics");
    await insertIcsFile(seriesId, "17:00 CET", 2026, "meeting-ics/tcwg2.ics", 0); // inactive, excluded

    const invite = await resolveWgJoinCalendarInviteByMailingListEmail(env.DB, "tcwg@lists.pkic.org");
    expect(invite?.workingGroupName).toBe("tcwg");
    expect(invite?.attachments).toHaveLength(1);
    expect(invite?.attachments[0].r2Key).toBe("meeting-ics/tcwg1.ics");

    const noMatch = await resolveWgJoinCalendarInviteByMailingListEmail(env.DB, "pkic@lists.pkic.org");
    expect(noMatch).toBeNull();
  });
});
