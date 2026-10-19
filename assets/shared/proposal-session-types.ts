import type { z } from "zod";
import type { proposalSessionTypeSchema } from "./schemas/proposal-management";

export type ProposalSessionType = z.infer<typeof proposalSessionTypeSchema>;

/** Configured display name; the existing label remains the stable reference identifier. */
export function sessionTypeName(type: Pick<ProposalSessionType, "label" | "name">): string {
  const name = type.name?.trim();
  if (name) return name;
  const words = type.label.trim().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
  return words ? words.charAt(0).toLocaleUpperCase("en-US") + words.slice(1) : type.label;
}

/** Resolve a current configured name while retaining readable retired or legacy identifiers. */
export function proposalSessionTypeLabel(type: string, configuredTypes?: readonly ProposalSessionType[]): string {
  const configured = configuredTypes?.find(
    (item) => item.label.toLocaleLowerCase("en-US") === type.toLocaleLowerCase("en-US"),
  );
  return sessionTypeName(configured ?? { label: type });
}
