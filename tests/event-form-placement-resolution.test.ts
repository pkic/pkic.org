import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eventFormsResponseSchema } from "../assets/shared/schemas/forms";
import { eventManagementDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { prepareDirectEventFormSelection } from "../functions/_lib/services/events/direct-form-selection";
import { getEventById } from "../functions/_lib/services/events";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

let eventId: string;
let userId: string;
let token: string;
const base = "/api/v1/events/pqc-2026";
const strict = { maxRoundTrips: 1 };
const at = () => new Date().toISOString();

beforeEach(async () => {
  await resetDb();
  const fixture = await seedEventAndAdmin(env.DB);
  eventId = fixture.eventId;
  userId = fixture.admin.id;
  token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  await env.DB.batch(
    ["event_registration", "proposal_submission"].flatMap((purpose) => [
      env.DB.prepare(`INSERT INTO forms(id,key,scope_type,scope_ref,purpose,status,title,created_at,updated_at)
      VALUES(?,?,'event',?,?,'active',?,?,?)`).bind(
        crypto.randomUUID(),
        purpose.replaceAll("_", "-"),
        eventId,
        purpose,
        purpose,
        at(),
        at(),
      ),
      env.DB.prepare(`INSERT INTO form_fields(id,form_id,key,label,field_type,required,sort_order,created_at,updated_at)
      VALUES(?,(SELECT id FROM forms WHERE key=?),'answer','Answer','text',0,0,?,?)`).bind(
        crypto.randomUUID(),
        purpose.replaceAll("_", "-"),
        at(),
        at(),
      ),
    ]),
  );
});

function save(body: Record<string, unknown>, environment = env) {
  return callApi(environment, `${base}/settings`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function revision() {
  return (await getEventById(env.DB, eventId)).updated_at;
}
async function configuration(purpose: string) {
  const response = await callApi(env, `${base}/forms/placements/${purpose}`, undefined, strict);
  expect(response.status, await response.clone().text()).toBe(200);
  return eventFormsResponseSchema.parse(await response.json());
}

describe("explicit event form placement resolution", () => {
  it("never inherits unplaced definitions or an installation-wide form", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO forms(id,key,scope_type,purpose,status,title,created_at,updated_at)
        VALUES(?,'global-registration','global','event_registration','active','Global questions',?,?)`).bind(
        crypto.randomUUID(),
        at(),
        at(),
      ),
      env.DB.prepare(`INSERT INTO form_placements(id,form_id,context_type,audience,active,created_at,updated_at)
        VALUES(?,(SELECT id FROM forms WHERE key='global-registration'),'installation','attendee',1,?,?)`).bind(
        crypto.randomUUID(),
        at(),
        at(),
      ),
      env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?").bind(
        JSON.stringify({ forms: { event_registration: "global-registration" } }),
        eventId,
      ),
    ]);
    expect((await configuration("event_registration")).form).toBeNull();
    expect((await configuration("proposal_submission")).form).toBeNull();
  });

  it("atomically selects both flows and derives editor links from placements", async () => {
    const response = await save({
      expectedUpdatedAt: await revision(),
      registrationFormKey: "event-registration",
      proposalFormKey: "proposal-submission",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const { event } = eventManagementDetailResponseSchema.parse(await response.json());
    expect(event.settings.forms).toEqual({
      event_registration: "event-registration",
      proposal_submission: "proposal-submission",
    });
    const stored = await env.DB.prepare("SELECT settings_json FROM events WHERE id=?")
      .bind(eventId)
      .first<{ settings_json: string }>();
    expect(JSON.parse(stored!.settings_json)).not.toHaveProperty("forms");
    for (const purpose of ["event_registration", "proposal_submission"]) {
      const form = (await configuration(purpose)).form;
      expect(form?.key).toBe(purpose.replaceAll("_", "-"));
      expect(form?.placement?.contextRef).toBe(eventId);
    }
    const cleared = await save({
      expectedUpdatedAt: event.updatedAt,
      registrationFormKey: null,
      proposalFormKey: null,
    });
    expect(cleared.status).toBe(200);
    expect((await configuration("event_registration")).form).toBeNull();
    expect((await configuration("proposal_submission")).form).toBeNull();
  });

  it("keeps another audience's placement separate when selecting the attendee form", async () => {
    const observerPlacementId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO form_placements(id,form_id,context_type,context_ref,audience,active,created_at,updated_at)
      VALUES(?,(SELECT id FROM forms WHERE key='event-registration'),'event',?,'observer',1,?,?)`)
      .bind(observerPlacementId, eventId, at(), at())
      .run();
    const response = await save({ expectedUpdatedAt: await revision(), registrationFormKey: "event-registration" });
    expect(response.status, await response.clone().text()).toBe(200);
    const form = (await configuration("event_registration")).form;
    expect(form?.placement?.audience).toBe("attendee");
    expect(form?.placement?.id).not.toBe(observerPlacementId);
    expect(
      await env.DB.prepare("SELECT active FROM form_placements WHERE id=?").bind(observerPlacementId).first("active"),
    ).toBe(1);
  });

  it("plans form selection in one preflight call and rolls back when its form revision changes", async () => {
    const db = profileD1Flow(env.DB);
    const event = await getEventById(env.DB, eventId);
    const statements = await prepareDirectEventFormSelection(
      db.db,
      event,
      "event_registration",
      at(),
      "event-registration",
    );
    expect(db.summary().roundTrips).toBe(1);
    await env.DB.prepare("UPDATE forms SET updated_at='2099-01-01T00:00:00.000Z' WHERE key='event-registration'").run();
    await expect(db.db.batch(statements)).rejects.toThrow();
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM form_placements WHERE context_ref=?")
        .bind(eventId)
        .first("total"),
    ).toBe(0);
  });

  it("rolls back selection and settings if event permission is revoked before commit", async () => {
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("UPDATE events"),
      async () => {
        await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(at(), userId).run();
      },
    );
    const response = await save(
      { expectedUpdatedAt: await revision(), registrationFormKey: "event-registration", venue: "Must roll back" },
      { ...env, DB: db },
    );
    expect(response.status, await response.clone().text()).toBe(409);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM form_placements WHERE context_ref=?")
        .bind(eventId)
        .first("total"),
    ).toBe(0);
    expect(JSON.parse((await getEventById(env.DB, eventId)).settings_json)).not.toHaveProperty("venue");
  });

  it("refuses unknown and wrong-purpose selections without updating configuration", async () => {
    for (const key of ["missing-form", "proposal-submission"]) {
      const response = await save({ expectedUpdatedAt: await revision(), registrationFormKey: key });
      expect(response.status, await response.clone().text()).toBe(409);
    }
    expect((await configuration("event_registration")).form).toBeNull();
  });
});
