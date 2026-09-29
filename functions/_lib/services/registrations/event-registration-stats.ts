export interface EventRegistrationStatsRow {
  attendance_type: string;
  status: string;
  count: number;
}

/** Shared aggregation for full-admin and least-privilege attendance views. */
export function aggregateEventRegistrationStats(rows: EventRegistrationStatsRow[]): {
  byAttendanceType: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const byAttendanceType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    if (row.status === "registered") {
      byAttendanceType[row.attendance_type] = (byAttendanceType[row.attendance_type] ?? 0) + Number(row.count);
    }
    byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
  }
  return { byAttendanceType, byStatus };
}
