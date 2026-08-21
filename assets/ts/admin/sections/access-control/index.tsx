import { useState } from "preact/hooks";
import { Tabs } from "../../../components/Tabs";
import { Grants } from "./Grants";
import { Roles } from "./Roles";
import { UserRoles } from "./UserRoles";

const TABS = [
  { key: "grants", label: "Access Grants" },
  { key: "roles", label: "Roles" },
  { key: "staff", label: "Staff" },
];

/**
 * Admin portal UI for access-control backend.
 *
 * "Working Groups" and "Chairs" used to live here as tabs but were promoted
 * to their own top-level sidebar sections (see Sidebar.tsx / AdminShell.tsx)
 * per 2026-07-30 testing feedback — they're day-to-day membership-management
 * tasks, not access-control configuration, and didn't belong buried in a tab.
 */
export function AccessControl() {
  const [tab, setTab] = useState("grants");

  return (
    <div>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === "grants" && <Grants />}
      {tab === "roles" && <Roles />}
      {tab === "staff" && <UserRoles />}
    </div>
  );
}
