import { EVENT_TEAM_ROLE_IDS } from "../../../assets/shared/schemas/event-team";
import { scannerCapabilities } from "../../../assets/shared/event-scanner-permissions";

const eventTeamRoles = Object.values(EVENT_TEAM_ROLE_IDS)
  .map((id) => `'${id}'`)
  .join(",");
const scannerActions = scannerCapabilities.map((permission) => `'${permission}'`).join(",");

/** Team-role scanner grants are effective only on an assignment to an event. Aliases are internal SQL names. */
export function eventTeamScannerRoleScopeSql(roleAlias: string, permissionAlias: string): string {
  return `CASE WHEN ${roleAlias}.role_id IN (${eventTeamRoles})
    AND ${permissionAlias}.permission IN (${scannerActions})
    THEN ${roleAlias}.context_type='event' ELSE 1 END`;
}
