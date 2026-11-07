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

/** How long before a session starts its online join opens, so remote viewers are in place for the start. */
export const ONLINE_JOIN_LEAD_MS = 15 * 60_000;

/**
 * Whether "Join online" leads to the session itself at `now`: from shortly before it starts until it ends.
 * Outside that window the location's stream shows another session, so the action is not offered.
 */
export function sessionOnlineJoinOpen(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now: number,
): boolean {
  const start = Date.parse(startAt ?? "");
  const end = Date.parse(endAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  return now >= start - ONLINE_JOIN_LEAD_MS && now < end;
}

/** The next instant after `now` at which {@link sessionOnlineJoinOpen} changes, or null when it no longer will. */
export function nextOnlineJoinBoundary(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now: number,
): number | null {
  const edges = [Date.parse(startAt ?? "") - ONLINE_JOIN_LEAD_MS, Date.parse(endAt ?? "")];
  return edges.filter((edge) => Number.isFinite(edge) && edge > now).sort((a, b) => a - b)[0] ?? null;
}
