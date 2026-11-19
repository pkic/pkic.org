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

export function loadEventEmailVariablesOnce(
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
