/**
 * An email tied to an event takes the event's sponsor image and links from the event at
 * delivery, so a sender never has to pass them. The generated sponsor image is linked only
 * when the site build published one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { processOutboxById, queueEmail } from "../functions/_lib/email/outbox";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import type { Env, StaticAssetsBinding } from "../functions/_lib/types";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const env = workerEnv as unknown as Env;
const SPONSORS_PATH = "/events/2026/pqc-2026/sponsors.jpg";

async function seedTemplate(adminId: string, templateKey: string, content: string): Promise<void> {
  const template = await createTemplateVersion(env.DB, {
    templateKey,
    content,
    createdByUserId: adminId,
    subjectTemplate: templateKey,
  });
  await activateTemplateVersion(env.DB, { templateKey, version: template.version });
}

function publishedAssets(paths: string[]): StaticAssetsBinding & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(
      async (request: Request) =>
        new Response(null, { status: paths.includes(new URL(request.url).pathname) ? 200 : 404 }),
    ),
  };
}

async function deliver(eventId: string | null, assets: StaticAssetsBinding): Promise<string> {
  let html = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      html = JSON.parse(String(init.body)).content.find((part: { type: string }) => part.type === "text/html").value;
      return new Response(null, { status: 202, headers: { "x-message-id": "sent" } });
    }),
  );
  const id = await queueEmail(env.DB, {
    eventId,
    templateKey: "agenda_changed",
    recipientEmail: "ada@example.test",
    messageType: "transactional",
    data: {},
  });
  await processOutboxById(env.DB, { ...env, ASSETS: assets }, id);
  return html;
}

describe("event email variables at delivery", () => {
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    const seed = await seedEventAndAdmin(env.DB);
    eventId = seed.eventId;
    await seedTemplate(seed.admin.id, "email_layout", "{{{body_html}}}");
    await seedTemplate(
      seed.admin.id,
      "agenda_changed",
      "{{eventName}} at {{eventUrl}}{{#if sponsorsImageUrl}} SPONSORS {{sponsorsImageUrl}}{{/if}}",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills the event's name, link and published sponsor image", async () => {
    const html = await deliver(eventId, publishedAssets([SPONSORS_PATH]));
    expect(html).toContain("PQC Conference 2026 at ");
    expect(html).toContain("/events/2026/pqc-2026/");
    expect(html).toContain("SPONSORS");
    expect(html).toContain(SPONSORS_PATH);
  });

  it("shows no sponsors when the build published no sponsor image", async () => {
    const html = await deliver(eventId, publishedAssets([]));
    expect(html).toContain("PQC Conference 2026");
    expect(html).not.toContain("SPONSORS");
  });

  it("leaves emails without an event alone", async () => {
    const assets = publishedAssets([SPONSORS_PATH]);
    expect(await deliver(null, assets)).not.toContain("SPONSORS");
    expect(assets.fetch).not.toHaveBeenCalled();
  });
});
