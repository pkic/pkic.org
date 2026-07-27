import { useEffect, useState } from "preact/hooks";
import { Tabs } from "../../../components/Tabs";
import { api } from "../../api";
import type { AdminUser } from "../../types";
import { Grants } from "./Grants";
import { Roles } from "./Roles";
import { UserRoles } from "./UserRoles";
import { WorkingGroups } from "./WorkingGroups";
import { Chairs } from "./Chairs";

const TABS = [
  { key: "grants", label: "Access Grants" },
  { key: "roles", label: "Roles" },
  { key: "staff", label: "Staff" },
  { key: "working-groups", label: "Working Groups" },
  { key: "chairs", label: "Chairs" },
];

/** PRD §2.4 — admin portal UI for Phase 2's access-control backend. */
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
      {tab === "working-groups" && <WorkingGroups />}
      {tab === "chairs" && <Chairs />}
    </div>
  );
}
