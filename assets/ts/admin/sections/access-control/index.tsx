import { useEffect, useState } from "preact/hooks";
import { Tabs } from "../../../components/Tabs";
import { api } from "../../api";
import type { AdminUser } from "../../types";
import { Grants } from "./Grants";
import { Roles } from "./Roles";
import { UserRoles } from "./UserRoles";

const TABS = [
  { key: "grants", label: "Access Grants" },
  { key: "roles", label: "Roles" },
  { key: "staff", label: "Staff" },
];

/**
 * PRD §2.4 — admin portal UI for Phase 2's access-control backend.
 *
 * "Working Groups" and "Chairs" used to live here as tabs but were promoted
 * to their own top-level sidebar sections (see Sidebar.tsx / AdminShell.tsx)
 * per 2026-07-30 testing feedback — they're day-to-day membership-management
 * tasks, not access-control configuration, and didn't belong buried in a tab.
 */
export function AccessControl() {
  const [tab, setTab] = useState("grants");
  const [userLabels, setUserLabels] = useState<Map<string, AdminUser>>(new Map());

  useEffect(() => {
    api<{ users: AdminUser[] }>("/api/v1/admin/users?limit=500")
      .then((d) => setUserLabels(new Map(d.users.map((u) => [u.id, u]))))
      .catch(() => {});
  }, []);

  return (
    <div>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === "grants" && <Grants userLabels={userLabels} />}
      {tab === "roles" && <Roles />}
      {tab === "staff" && <UserRoles />}
    </div>
  );
}
