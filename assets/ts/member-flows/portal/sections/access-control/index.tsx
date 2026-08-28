import { useState } from "preact/hooks";
import { Tabs } from "../../../../components/Tabs";
import { Grants } from "./Grants";
import { Roles } from "./Roles";
import { UserRoles } from "./UserRoles";

const TABS = [
  { key: "grants", label: "Access Grants" },
  { key: "roles", label: "Roles" },
  { key: "staff", label: "Staff" },
];

/**
 * Portal UI for global access-control administration.
 *
 * Group management and leadership use each group's own contextual views. They
 * are day-to-day group responsibilities, not global access-control settings,
 * and therefore do not belong in this System destination.
 */
export function AccessControl({ canGrant = true, canRevoke = true }: { canGrant?: boolean; canRevoke?: boolean } = {}) {
  const [tab, setTab] = useState("grants");

  return (
    <div>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === "grants" && <Grants canGrant={canGrant} canRevoke={canRevoke} />}
      {tab === "roles" && <Roles canGrant={canGrant} canRevoke={canRevoke} />}
      {tab === "staff" && <UserRoles canGrant={canGrant} canRevoke={canRevoke} />}
    </div>
  );
}
