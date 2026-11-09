import type { DatabaseLike } from "../types";
import { loadEmailRenderResources } from "./partials";
import { resolveTemplate } from "./templates";

type ResolvedEmailTemplate = Awaited<ReturnType<typeof resolveTemplate>>;

/** Immutable render inputs shared by the messages of one processing run. */
export interface OutboxProcessingContext {
  renderResources?: Promise<{ partials: Record<string, string>; layoutHtml: string }>;
  templates: Map<string, Promise<ResolvedEmailTemplate>>;
}

export function createOutboxProcessingContext(): OutboxProcessingContext {
  return { templates: new Map() };
}

/** A failed read is forgotten so one transient error cannot fail every later message. */
function forgetOnRejection<T>(pending: Promise<T>, forget: () => void): Promise<T> {
  pending.catch(forget);
  return pending;
}

export function loadRenderResources(
  db: DatabaseLike,
  context: OutboxProcessingContext,
): Promise<{ partials: Record<string, string>; layoutHtml: string }> {
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
