/** The event workspace's tabs and the capability each one needs, in display order. */
import { hasEventAgendaPermission } from "../events/event-agenda-access";
import { portalSession } from "../../state";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import type { TabItem } from "../../../../components/Tabs";

interface EventWorkspaceTabDef extends TabItem {
  visible: (event: GroupEvent) => boolean;
}

export const GROUP_EVENT_OVERVIEW_TAB = "overview";

export const EVENT_WORKSPACE_TABS: readonly EventWorkspaceTabDef[] = [
  { key: GROUP_EVENT_OVERVIEW_TAB, label: "Overview", visible: () => true },
  {
    key: "registrations",
    label: "Registrations",
    visible: (event) => event.capabilities.includes("manage_attendance") || event.capabilities.includes("manage"),
  },
  { key: "agenda", label: "Agenda", visible: (event) => hasEventAgendaPermission(event.id, "agenda:read") },
  {
    key: "scanner",
    label: "Scanner",
    visible: (event) =>
      ["agenda:scan", "agenda:check", "agenda:admit", "agenda:attendance_record"].some((permission) =>
        hasEventAgendaPermission(event.id, permission as "agenda:scan"),
      ),
  },
  {
    key: "live",
    label: "Studio",
    visible: (event) => hasEventAgendaPermission(event.id, "agenda:live_moderate"),
  },
  {
    key: "leads",
    label: "Sponsor leads",
    visible: () =>
      portalSession.value?.staff?.grants.some(
        (grant) =>
          grant.contextType === "event_sponsor" &&
          ["agenda:leads_view", "agenda:leads_capture", "agenda:leads_export"].includes(grant.permission),
      ) ?? false,
  },
  { key: "proposals", label: "Proposals", visible: (event) => event.proposalAccess?.canRead === true },
  {
    key: "invitations",
    label: "Invitations",
    visible: (event) => event.capabilities.includes("manage") || event.proposalAccess?.canFinalize === true,
  },
  { key: "communications", label: "Communications", visible: (event) => event.capabilities.includes("manage") },
  {
    key: "stats",
    label: "Analytics",
    visible: (event) =>
      event.capabilities.includes("manage_attendance") ||
      hasEventAgendaPermission(event.id, "agenda:attendance_read") ||
      hasEventAgendaPermission(event.id, "agenda:attendance_import"),
  },
  {
    key: "settings",
    label: "Settings",
    visible: (event) =>
      event.capabilities.includes("manage") ||
      hasEventAgendaPermission(event.id, "agenda:write") ||
      hasEventAgendaPermission(event.id, "agenda:live_moderate"),
  },
];

export function visibleEventWorkspaceTabs(event: GroupEvent): TabItem[] {
  return EVENT_WORKSPACE_TABS.filter((tab) => tab.visible(event)).map(({ key, label: tabLabel }) => ({
    key,
    label: tabLabel,
  }));
}
