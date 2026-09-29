/**
 * No dead ends: an entity named on screen should be reachable when the
 * viewer has access to it. Renders a real link when a route is resolvable,
 * and degrades to plain text otherwise — a viewer without access sees the
 * name, not a broken or misleading link.
 */
import type { ComponentChildren } from "preact";
import { Link } from "wouter";

export function EntityLink({ href, children }: { href: string | null; children: ComponentChildren }) {
  if (href) return <Link href={href}>{children}</Link>;
  return <span>{children}</span>;
}
