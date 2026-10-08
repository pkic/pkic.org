export function attendancePath(basePath: string, section: string, detail?: string) {
  return (
    `#/` + [basePath.replace(/^\/+|\/+$/g, ""), section, ...(detail ? [encodeURIComponent(detail)] : [])].join("/")
  );
}

export function attendanceOutcomeLabel(outcome: string) {
  return (
    (
      {
        eligible: "Successful",
        warning: "Needs attention",
        denied: "Not allowed",
        unknown: "Unknown badge",
        unverified: "Could not verify",
      } as Record<string, string>
    )[outcome] ?? "Outcome not available"
  );
}

export function attendanceReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    verification_required: "The badge or attendance context could not be verified. No attendance was recorded.",
    unknown_credential: "The code was not recognized.",
    revoked_badge: "This badge has been revoked.",
    expired_badge: "This badge has expired.",
    missing_registration: "No registration was found for this event or session.",
    canceled_registration: "The registration has been canceled.",
    wrong_location: "The badge does not match the selected location.",
    wrong_attendance_mode: "The registration does not match the selected attendance mode.",
    consent_required: "Consent is required before recording this action.",
    eligible: "The registration was verified.",
    recorded: "The attendance observation was recorded.",
    contact_retention_expired: "The event's contact access period has ended.",
    captured: "The record was saved.",
    capacity: "The requested admission could not be approved.",
    exception: "An authorized exception was reviewed.",
  };
  return labels[reason] ?? reason.replaceAll("_", " ");
}

export function attendanceActionLabel(action: string) {
  return (
    (
      {
        check: "Check eligibility",
        admission: "Admission decision",
        attendance: "Record attendance",
        exception: "Reviewed exception",
        checkout: "Check out",
        lead: "Capture lead",
      } as Record<string, string>
    )[action] ?? action.replaceAll("_", " ")
  );
}
