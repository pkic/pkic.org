import type { GroupSettingsDetail } from "../../../../../shared/schemas/groups";

export type GroupSettingsDraft = Pick<
  GroupSettingsDetail,
  | "name"
  | "links"
  | "visibility"
  | "governanceInheritanceMode"
  | "eligibilityMode"
  | "automaticEnrollmentMode"
  | "allowAutomaticOptOut"
  | "publicLeadership"
  | "publicRoster"
  | "minEndorsersForBallot"
  | "active"
> & { description: string };

export function draftFromGroup(group: GroupSettingsDetail): GroupSettingsDraft {
  return {
    name: group.name,
    description: group.description ?? "",
    links: group.links,
    visibility: group.visibility,
    governanceInheritanceMode: group.governanceInheritanceMode,
    eligibilityMode: group.eligibilityMode,
    automaticEnrollmentMode: group.automaticEnrollmentMode,
    allowAutomaticOptOut: group.allowAutomaticOptOut,
    publicLeadership: group.publicLeadership,
    publicRoster: group.publicRoster,
    minEndorsersForBallot: group.minEndorsersForBallot,
    active: group.active,
  };
}

export function optionLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
