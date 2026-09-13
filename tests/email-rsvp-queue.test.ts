import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueRsvpEmail, consumeRsvpEmails } from "../functions/_lib/services/calendar-rsvp-email-queue";
import { queuedRsvpEmailSchema, type QueuedRsvpEmail } from "../assets/shared/schemas/calendar-rsvp-email-queue";
import { generateSignedRsvpAddress } from "../functions/_lib/email/rsvp";
import type { Env } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { seedRsvpRegistration } from "./helpers/rsvp";
import { queryAll } from "./helpers/context";

function queuedEnvironment() {
  const queued: QueuedRsvpEmail[] = [];
  const send = vi.fn(async (body: QueuedRsvpEmail) => {
    queued.push(queuedRsvpEmailSchema.parse(body));
    return { metadata: { metrics: { backlogCount: queued.length, backlogBytes: 0 } } };
  });
  const environment: Env = {
    ...env,
    RSVP_EMAIL_QUEUE_ENABLED: "true",
    RSVP_EMAIL_QUEUE: { send, sendBatch: vi.fn(), metrics: vi.fn() },
  };
  return { environment, queued, send };
}

function batchFor(body: unknown) {
  const ack = vi.fn();
  const retry = vi.fn();
  const batch = {
    queue: "pkic-rsvp-email-local",
    metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
    messages: [{ body, id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, ack, retry }],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
  return { batch, ack, retry };
}

async function incoming(environment: Env) {
  const { registrationId } = await seedRsvpRegistration(env.DB);
  const to = await generateSignedRsvpAddress(
    registrationId,
    environment.INTERNAL_SIGNING_SECRET!,
    environment.RSVP_EMAIL,
  );
  const raw = `From: Alice <alice@example.com>\r\nMessage-ID: <${crypto.randomUUID()}@example.test>\r\nSubject: Accepted: Meeting\r\nContent-Type: text/plain\r\n\r\nAccepted`;
  return { from: "alice@example.com", to, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}

describe("durable inbound RSVP queue", () => {
  beforeEach(resetDb);

  it("stores before acceptance, pauses without D1, resumes, and acknowledges duplicate deliveries safely", async () => {
    const { environment, queued } = queuedEnvironment();
    await enqueueRsvpEmail(await incoming(environment), environment);
    const body = queued[0];
    expect(Object.keys(body).sort()).toEqual(["id", "version"]);
    expect(await environment.RSVP_EMAIL_BUCKET!.head(`rsvp/pending/${body.id}.eml`)).not.toBeNull();
    const delivery = batchFor(body);
    await consumeRsvpEmails(delivery.batch, {
      ...environment,
      SERVICE_MODE: "maintenance",
      DB: {
        prepare: () => {
          throw new Error("D1 must not be called while paused");
        },
        batch: vi.fn(),
      },
    });
    expect(delivery.retry).toHaveBeenCalledWith({ delaySeconds: 3600 });
    expect(delivery.ack).not.toHaveBeenCalled();
    const resumed = batchFor(body);
    await consumeRsvpEmails(resumed.batch, environment);
    expect(resumed.ack).toHaveBeenCalledOnce();
    expect(await environment.RSVP_EMAIL_BUCKET!.head(`rsvp/pending/${body.id}.eml`)).toBeNull();
    const duplicate = batchFor(body);
    await consumeRsvpEmails(duplicate.batch, environment);
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(1);
  });

  it("retries a dependency failure without acknowledging or deleting the MIME payload", async () => {
    const { environment, queued } = queuedEnvironment();
    await enqueueRsvpEmail(await incoming(environment), environment);
    const delivery = batchFor(queued[0]);
    await consumeRsvpEmails(delivery.batch, {
      ...environment,
      DB: {
        prepare: () => {
          throw new Error("D1_ERROR: Network connection lost.");
        },
        batch: vi.fn(),
      },
    });
    expect(delivery.retry).toHaveBeenCalledOnce();
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(await environment.RSVP_EMAIL_BUCKET!.head(`rsvp/pending/${queued[0].id}.eml`)).not.toBeNull();
  });

  it("retains accepted mail when signing configuration is lost or changed, then recovers", async () => {
    const { environment, queued } = queuedEnvironment();
    await enqueueRsvpEmail(await incoming(environment), environment);
    for (const secret of [undefined, "changed-signing-key"]) {
      const delivery = batchFor(queued[0]);
      await consumeRsvpEmails(delivery.batch, { ...environment, INTERNAL_SIGNING_SECRET: secret });
      expect(delivery.retry).toHaveBeenCalledOnce();
      expect(delivery.ack).not.toHaveBeenCalled();
      expect(await environment.RSVP_EMAIL_BUCKET!.head(`rsvp/pending/${queued[0].id}.eml`)).not.toBeNull();
      expect(await environment.RSVP_EMAIL_BUCKET!.head(`rsvp/processed/${queued[0].id}.json`)).toBeNull();
    }
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(0);
    const recovered = batchFor(queued[0]);
    await consumeRsvpEmails(recovered.batch, environment);
    expect(recovered.ack).toHaveBeenCalledOnce();
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(1);
  });

  it("does not claim acceptance if queue publication fails", async () => {
    const { environment, send } = queuedEnvironment();
    send.mockRejectedValueOnce(new Error("Queue unavailable"));
    await expect(enqueueRsvpEmail(await incoming(environment), environment)).rejects.toThrow("Queue unavailable");
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps missing payloads and malformed messages unacknowledged for retries and dead-letter handling", async () => {
    const { environment } = queuedEnvironment();
    for (const body of [{ version: 1, id: crypto.randomUUID() }, { id: "../../private" }]) {
      const delivery = batchFor(body);
      await consumeRsvpEmails(delivery.batch, environment);
      expect(delivery.ack).not.toHaveBeenCalled();
      expect(delivery.retry).toHaveBeenCalledOnce();
    }
  });
});
