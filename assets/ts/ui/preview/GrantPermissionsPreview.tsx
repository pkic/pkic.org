/** Gallery specimen: the permissions of an access grant, picked in the role editor's own matrix. */
import { useState } from "preact/hooks";
import type { Permission } from "../../../shared/schemas/permissions";
import { RolePermissions } from "../../member-flows/portal/sections/access-control/roles/RolePermissions";

function GrantPermissions() {
  const [selected, setSelected] = useState<ReadonlySet<Permission>>(new Set<Permission>(["events:read", "users:read"]));
  return (
    <fieldset class="pk-fieldset pk-field">
      <legend class="pk-field__label">Permissions</legend>
      <RolePermissions selected={selected} onSelect={setSelected} />
      <p class="pk-field__help">
        Each one is granted to this person on its own. For a job that many people do, assign a role instead.
      </p>
    </fieldset>
  );
}

export const grantPermissionsSection = {
  id: "grant-permissions",
  title: "Access grant: permissions",
  render: () => <GrantPermissions />,
};
