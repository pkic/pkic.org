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

interface AgendaMediaRoom {
  id: string;
  equipment?: readonly string[];
  virtualRoomUrl?: string | null;
}
interface AgendaMediaOccurrence {
  roomId: string | null;
  plannedMedia?: AgendaMediaCapabilities | null;
  virtualRoomUrl?: string | null;
}

/**
 * The media a session actually plans. Without its own plan a session follows its primary location's
 * planned media and virtual-room link; a session link authored before inheritance still takes precedence.
 */
export function agendaOccurrenceMedia(rooms: readonly AgendaMediaRoom[], occurrence: AgendaMediaOccurrence) {
  const room = occurrence.roomId ? rooms.find((candidate) => candidate.id === occurrence.roomId) : undefined;
  const inherited = occurrence.plannedMedia == null;
  const plan = occurrence.plannedMedia ?? agendaMediaCapabilities(room?.equipment);
  return {
    inherited,
    recording: plan.recording,
    liveStreaming: plan.liveStreaming,
    virtualRoomUrl: occurrence.virtualRoomUrl || (inherited ? room?.virtualRoomUrl : null) || null,
  };
}

/** An explicit session plan is a location requirement like any other required equipment. */
export function agendaOccurrenceRequiredEquipment(occurrence: {
  requiredEquipment?: readonly string[];
  plannedMedia?: AgendaMediaCapabilities | null;
}) {
  const equipment = occurrence.requiredEquipment ?? [];
  return occurrence.plannedMedia
    ? [...new Set(withAgendaMediaCapabilities(equipment, occurrence.plannedMedia))]
    : [...equipment];
}
