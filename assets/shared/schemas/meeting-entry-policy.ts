import { z } from "zod";

/** A personal calendar link identifies the invitee; this policy controls how recently the browser must be verified. */
export const MEETING_ENTRY_AUTHENTICATIONS = ["remember_browser", "always"] as const;
export const meetingEntryPolicySchema = z.object({
  authentication: z.enum(MEETING_ENTRY_AUTHENTICATIONS),
  rememberDays: z.number().int().min(1).max(90),
});
export type MeetingEntryPolicy = z.infer<typeof meetingEntryPolicySchema>;

export const DEFAULT_MEETING_ENTRY_POLICY: MeetingEntryPolicy = {
  authentication: "remember_browser",
  rememberDays: 30,
};

export function meetingEntryPolicyFromSettings(settings: unknown): MeetingEntryPolicy {
  if (!settings || typeof settings !== "object") return DEFAULT_MEETING_ENTRY_POLICY;
  const parsed = meetingEntryPolicySchema.safeParse((settings as Record<string, unknown>).meetingEntryPolicy);
  return parsed.success ? parsed.data : DEFAULT_MEETING_ENTRY_POLICY;
}
