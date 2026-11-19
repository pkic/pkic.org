/**
 * The steps of event registration, by name and in order.
 *
 * The registration flow draws them as its progress, and the sign-in card shows
 * the same component to someone arriving to register, so the two cannot
 * disagree about what registering takes.
 */
import { EventFlowProgress } from "../../site/EventFlowProgress";

const REGISTRATION_STEPS = ["You", "Attendance", "Profile", "Review"];

export function RegistrationProgress() {
  return <EventFlowProgress label="Registration progress" steps={REGISTRATION_STEPS} />;
}
