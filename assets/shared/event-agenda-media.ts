/** Explicit equipment keys; unrelated equipment never implies either media capability. */
export const AGENDA_MEDIA_EQUIPMENT_KEYS = { recording: "recording", liveStreaming: "live_streaming" } as const;

export function agendaMediaCapabilities(equipment: readonly string[] = []) {
  const keys = new Set(equipment.map((key) => key.trim().toLowerCase()));
  return {
    recording: keys.has(AGENDA_MEDIA_EQUIPMENT_KEYS.recording),
    liveStreaming: keys.has(AGENDA_MEDIA_EQUIPMENT_KEYS.liveStreaming),
  };
}

export type AgendaMediaCapabilities = ReturnType<typeof agendaMediaCapabilities>;

export function withoutAgendaMediaEquipment(equipment: readonly string[] = []) {
  return equipment.filter(
    (key) => !Object.values(AGENDA_MEDIA_EQUIPMENT_KEYS).some((reserved) => key.trim().toLowerCase() === reserved),
  );
}

export function withAgendaMediaCapabilities(equipment: readonly string[], flags: AgendaMediaCapabilities) {
  return [
    ...withoutAgendaMediaEquipment(equipment),
    ...(flags.recording ? [AGENDA_MEDIA_EQUIPMENT_KEYS.recording] : []),
    ...(flags.liveStreaming ? [AGENDA_MEDIA_EQUIPMENT_KEYS.liveStreaming] : []),
  ];
}
