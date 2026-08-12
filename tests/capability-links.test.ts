import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  materializeQueuedCapabilityLinks,
  newCapabilityLinkSecret,
  issueDatabaseCapability,
  queuedCapabilityToken,
  signCapabilityToken,
  verifyCapabilityToken,
  verifyDatabaseCapability,
} from "../functions/_lib/services/capability-links";
import { resetDb } from "./helpers/reset-db";
import { run } from "../functions/_lib/db/queries";
import { nowIso } from "../functions/_lib/utils/time";

const signingSecret = "capability-test-signing-secret";
const textEncoder = new TextEncoder();

describe("public capability links", () => {
  beforeEach(async () => resetDb());

  it("signs purpose-bound, expiring tokens and invalidates them after secret rotation", async () => {
    const linkSecret = newCapabilityLinkSecret();
    const token = await signCapabilityToken({
      signingSecret,
      linkSecret,
      purpose: "registration_manage",
      resourceId: "registration-1",
      ttlSeconds: 60,
      nowSeconds: 1_000,
    });

    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret,
        purpose: "registration_manage",
        token,
        nowSeconds: 1_030,
      }),
    ).resolves.toMatchObject({ ok: true, resourceId: "registration-1" });
    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret,
        purpose: "proposal_manage",
        token,
        nowSeconds: 1_030,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret,
        purpose: "registration_manage",
        token,
        nowSeconds: 1_061,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(
      verifyCapabilityToken({
        signingSecret,
        linkSecret: newCapabilityLinkSecret(),
        purpose: "registration_manage",
        token,
        nowSeconds: 1_030,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("materializes queued placeholders without persisting a signed token", async () => {
    const now = nowIso();
    await run(
      env.DB,
      "INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["event-capability", "event-capability", "Capability Event", "UTC", now, now],
    );
    await run(
      env.DB,
      "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["user-capability", "user@example.test", "user@example.test", "user", 1, now, now],
    );
    const linkSecret = newCapabilityLinkSecret();
    await run(
      env.DB,
      `INSERT INTO registrations (
        id, event_id, user_id, status, attendance_type, source_type,
        manage_link_secret, capacity_exempt_in_person, created_at, updated_at
      ) VALUES (?, ?, ?, 'registered', 'virtual', 'test', ?, 0, ?, ?)`,
      ["registration-capability", "event-capability", "user-capability", linkSecret, now, now],
    );
    const marker = queuedCapabilityToken("registration_manage", "registration-capability");
    const storedPayload = { manageUrl: `https://example.test/manage?token=${marker}`, nested: [marker] };

    const materialized = await materializeQueuedCapabilityLinks(
      env.DB,
      { INTERNAL_SIGNING_SECRET: signingSecret },
      storedPayload,
    );
    expect(JSON.stringify(storedPayload)).toContain(marker);
    expect(JSON.stringify(storedPayload)).not.toContain("pkc1_");
    const token = new URL(materialized.manageUrl as string).searchParams.get("token")!;
    expect(token).toMatch(/^pkc1_/);
    expect(materialized.nested).toEqual([token]);
    await expect(
      verifyDatabaseCapability({
        db: env.DB,
        signingSecret,
        purpose: "registration_manage",
        token,
      }),
    ).resolves.toMatchObject({ ok: true, resourceId: "registration-capability" });

    const foldedMarker = `${marker.slice(0, 24)}\r\n ${marker.slice(24)}`;
    const calendarPayload = await materializeQueuedCapabilityLinks(
      env.DB,
      { INTERNAL_SIGNING_SECRET: signingSecret },
      { ics: `BEGIN:VCALENDAR\r\nURL:https://example.test/manage?token=${foldedMarker}\r\nEND:VCALENDAR\r\n` },
    );
    const materializedIcs = calendarPayload.ics as string;
    expect(materializedIcs).not.toContain("pkcq1_");
    expect(materializedIcs.replace(/\r\n /g, "")).toContain(`token=${token}`);
    expect(materializedIcs.split("\r\n").every((line) => textEncoder.encode(line).length <= 75)).toBe(true);
  });

  it("initializes a legacy speaker secret with Web Crypto when first issuing a link", async () => {
    const now = nowIso();
    await run(
      env.DB,
      "INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["event-speaker", "event-speaker", "Speaker Event", "UTC", now, now],
    );
    await run(
      env.DB,
      "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["user-speaker", "speaker@example.test", "speaker@example.test", "user", 1, now, now],
    );
    await run(
      env.DB,
      `INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        manage_link_secret, submitted_at, updated_at
      ) VALUES (?, ?, ?, 'submitted', 'talk', 'Talk', 'Abstract', ?, ?, ?)`,
      ["proposal-speaker", "event-speaker", "user-speaker", newCapabilityLinkSecret(), now, now],
    );
    await run(
      env.DB,
      `INSERT INTO proposal_speakers (
        id, proposal_id, user_id, role, status, manage_link_secret, created_at
      ) VALUES (?, ?, ?, 'speaker', 'invited', NULL, ?)`,
      ["speaker-legacy", "proposal-speaker", "user-speaker", now],
    );

    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "speaker_manage",
      resourceId: "speaker-legacy",
    });
    const row = await env.DB.prepare("SELECT manage_link_secret FROM proposal_speakers WHERE id = ?")
      .bind("speaker-legacy")
      .first<{ manage_link_secret: string | null }>();

    expect(row?.manage_link_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      verifyDatabaseCapability({ db: env.DB, signingSecret, purpose: "speaker_manage", token }),
    ).resolves.toMatchObject({ ok: true, resourceId: "speaker-legacy" });
  });

  it("applies the consolidated schema migration without retaining obsolete token columns", async () => {
    const registrationColumns = await env.DB.prepare("PRAGMA table_info(registrations)").all<{ name: string }>();
    const speakerColumns = await env.DB.prepare("PRAGMA table_info(proposal_speakers)").all<{ name: string }>();

    expect(registrationColumns.results.map((column: { name: string }) => column.name)).toEqual(
      expect.arrayContaining(["confirmation_link_secret", "manage_link_secret"]),
    );
    expect(registrationColumns.results.map((column: { name: string }) => column.name)).not.toEqual(
      expect.arrayContaining(["confirmation_token_hash", "confirmation_token_expires_at", "manage_token_hash"]),
    );
    expect(speakerColumns.results.map((column: { name: string }) => column.name)).toContain("manage_link_secret");
    expect(speakerColumns.results.map((column: { name: string }) => column.name)).not.toContain("manage_token_hash");
  });
});
