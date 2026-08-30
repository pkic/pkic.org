import type { GroupCapability } from "../../../../../shared/schemas/groups";

// Ordered by how often each view is the reason someone opens the group:
// people and activity first, then communication, then administration.
export const GROUP_CONTEXT_VIEWS = [
  { key: "overview", label: "Overview", capabilities: ["view"] },
  { key: "members", label: "Members", capabilities: ["manage"] },
  { key: "events", label: "Events", capabilities: ["participate", "manage"] },
  { key: "meetings", label: "Meetings", capabilities: ["participate", "manage"] },
  { key: "votes", label: "Votes", capabilities: ["participate", "manage"] },
  { key: "forms", label: "Forms", capabilities: ["participate", "manage"] },
  { key: "mailing-lists", label: "Mailing lists", capabilities: ["participate", "manage"] },
  { key: "leadership", label: "Leadership", capabilities: ["manage"] },
  { key: "stats", label: "Statistics", capabilities: ["manage"] },
  { key: "audit", label: "Audit log", capabilities: ["manage"] },
  { key: "settings", label: "Settings", capabilities: ["manage"] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  capabilities: readonly GroupCapability[];
}>;

export type GroupContextView = (typeof GROUP_CONTEXT_VIEWS)[number]["key"];

export function groupContextNavigation(capabilities: readonly GroupCapability[]) {
  const effective = new Set(capabilities);
  return GROUP_CONTEXT_VIEWS.filter((item) => item.capabilities.some((capability) => effective.has(capability)));
}
