/**
 * Settings consumed by event email, capability links, calendars, and reminder policy.
 * Project before crossing D1: repeating badge artwork or the agenda per recipient
 * can exceed the RPC payload limit even for a bounded recipient selection.
 * Preserve missing keys versus explicit null (notably sponsorsImageUrl).
 */
export function eventCommunicationSettingsSql(settingsSql: string): string {
  return `(SELECT json_group_object(setting.key,
    CASE WHEN setting.type IN ('object','array') THEN json(setting.value) ELSE setting.value END)
    FROM json_each(CASE WHEN json_valid(${settingsSql}) THEN ${settingsSql} ELSE '{}' END) setting
    WHERE setting.key IN ('frontend','sponsorsImageUrl','venue','registration','registrationClosesAt','proposal'))`;
}
