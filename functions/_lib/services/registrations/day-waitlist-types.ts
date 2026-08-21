export type DayWaitlistLane = "continuity" | "general";

export interface EventDayCapacityRow {
  id: string;
  day_date: string;
  in_person_capacity: number | null;
  capacity_revision: number;
}

export interface DayWaitlistRow {
  id: string;
  event_id: string;
  event_day_id: string;
  registration_id: string;
  user_id: string;
  priority_lane: DayWaitlistLane;
  status: "waiting" | "offered" | "accepted" | "expired" | "removed";
  position: number;
  offer_expires_at: string | null;
}

export interface PlannedDayWaitlistEntry {
  dayDate: string;
  status: "waiting" | "offered" | "accepted";
  priorityLane: DayWaitlistLane;
  offerExpiresAt: string | null;
}
