/** Presentation displays include the event's Gold sponsors and higher tiers. */
export function conferenceDisplaySponsorSelection(eventName: unknown): Record<string, string> {
  return {
    mode: "strip",
    ...(typeof eventName === "string" && eventName ? { eventName } : {}),
    minWeight: "4",
  };
}
