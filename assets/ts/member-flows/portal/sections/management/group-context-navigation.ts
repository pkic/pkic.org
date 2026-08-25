import type { GroupPortalCapability } from "../../../../../shared/schemas/groups";

export const GROUP_CONTEXT_VIEWS = [
  { key: "overview", label: "Overview", capabilities: ["view"] },
  { key: "events", label: "Events", capabilities: ["participate", "manage"] },
  { key: "meetings", label: "Meetings", capabilities: ["participate", "manage"] },
  { key: "forms", label: "Forms", capabilities: ["participate", "manage"] },
  { key: "votes", label: "Votes", capabilities: ["participate", "manage"] },
  { key: "mailing-lists", label: "Mailing lists", capabilities: ["participate"] },
  { key: "audit", label: "Audit log", capabilities: ["manage"] },
  { key: "settings", label: "Settings", capabilities: ["manage"] },
  { key: "members", label: "Members", capabilities: ["manage"] },
  { key: "leadership", label: "Leadership", capabilities: ["manage"] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  capabilities: readonly GroupPortalCapability[];
}>;

export type GroupContextView = (typeof GROUP_CONTEXT_VIEWS)[number]["key"];

export function groupContextNavigation(capabilities: readonly GroupPortalCapability[]) {
  const effective = new Set(capabilities);
  return GROUP_CONTEXT_VIEWS.filter((item) => item.capabilities.some((capability) => effective.has(capability)));
}
