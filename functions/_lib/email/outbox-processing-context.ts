import type { EventEmailVariables } from "./event-email-variables";
import type { DatabaseLike, Env } from "../types";
import { loadEventEmailVariables } from "./event-email-variables";
import { loadEmailRenderResources, type EmailRenderResources } from "./partials";
import { resolveTemplate } from "./templates";

type ResolvedEmailTemplate = Awaited<ReturnType<typeof resolveTemplate>>;

/** Immutable render inputs shared by the messages of one processing run. */
export interface OutboxProcessingContext {
  renderResources?: Promise<EmailRenderResources>;
  templates: Map<string, Promise<ResolvedEmailTemplate>>;
  events: Map<string, Promise<EventEmailVariables | null>>;
}

export function createOutboxProcessingContext(): OutboxProcessingContext {
  return { templates: new Map(), events: new Map() };
}

/** A failed read is forgotten so one transient error cannot fail every later message. */
function forgetOnRejection<T>(pending: Promise<T>, forget: () => void): Promise<T> {
  pending.catch(forget);
  return pending;
}

export function loadRenderResources(db: DatabaseLike, context: OutboxProcessingContext): Promise<EmailRenderResources> {
  context.renderResources ??= forgetOnRejection(loadEmailRenderResources(db), () => {
    delete context.renderResources;
  });
  return context.renderResources;
}

export function resolveTemplateOnce(
  db: DatabaseLike,
  context: OutboxProcessingContext,
  templateKey: string,
): Promise<ResolvedEmailTemplate> {
  const existing = context.templates.get(templateKey);
  if (existing) return existing;
  const pending = forgetOnRejection(resolveTemplate(db, templateKey), () => context.templates.delete(templateKey));
  context.templates.set(templateKey, pending);
  return pending;
}

function loadEventEmailVariablesOnce(
  db: DatabaseLike,
  env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC">,
  context: OutboxProcessingContext,
  eventId: string,
  siteBaseUrl: string,
): Promise<EventEmailVariables | null> {
  const key = `${eventId} ${siteBaseUrl}`;
  const existing = context.events.get(key);
  if (existing) return existing;
  const pending = forgetOnRejection(loadEventEmailVariables(db, env, eventId, siteBaseUrl), () =>
    context.events.delete(key),
  );
  context.events.set(key, pending);
  return pending;
}

/**
 * A queued payload with its event's variables. The event supplies its own name and links under
 * what the sender wrote; its sponsor image always comes from the event, so an event without one
 * never links a missing image.
 */
export async function withEventEmailVariables<T extends Record<string, unknown>>(
  db: DatabaseLike,
  env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC">,
  context: OutboxProcessingContext,
  eventId: string | null,
  siteBaseUrl: string,
  payload: T,
): Promise<T> {
  if (!eventId) return payload;
  const eventVariables = await loadEventEmailVariablesOnce(db, env, context, eventId, siteBaseUrl);
  if (!eventVariables) return payload;
  return { ...eventVariables, ...payload, sponsorsImageUrl: eventVariables.sponsorsImageUrl };
}
