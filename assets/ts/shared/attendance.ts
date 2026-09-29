export const ATTENDANCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  in_person: "In-person",
  virtual: "Virtual",
  on_demand: "On-demand",
  not_attending: "Not attending",
};

/** Return a readable label for known and future attendance types. */
export function attendanceTypeLabel(type: string | null | undefined): string {
  if (!type) return "Not specified";
  const knownLabel = ATTENDANCE_TYPE_LABELS[type];
  if (knownLabel) return knownLabel;

  const normalized = type.replaceAll("_", " ").trim();
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : "Not specified";
}
