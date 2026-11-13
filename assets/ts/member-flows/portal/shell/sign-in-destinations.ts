/**
 * What the sign-in card says about the flow a person arrived for.
 *
 * Signing in is one screen for every flow, and it stays ignorant of them: a
 * flow describes itself here in words, and may hand the card its own progress
 * component to show what it takes. The card draws what it is handed. A return
 * path no flow claims gets the plain sign-in card.
 */
import type { SignInDestination } from "../../../components/sign-in/sign-in-destination";

const SIGN_IN_DESTINATIONS: readonly SignInDestination[] = [
  {
    pattern: /^\/events\/([^/?]+)\/register(?:[/?]|$)/,
    title: "Register for this event",
    lede: "Been here before? Sign in. New here? Start with your email below.",
    startHint: "Start with your email. We confirm it is yours and take you straight to registration.",
    startLabel: "Start registration",
    emailFlow: "registration",
    load: async (returnPath) => {
      const registration = await import("../../../components/events/registration-sign-in");
      const slug = /^\/events\/([^/?]+)\//.exec(returnPath)?.[1];
      const name = slug ? await registration.registrationEventName(decodeURIComponent(slug)) : null;
      return { Progress: registration.RegistrationProgress, title: name ? `Register for ${name}` : undefined };
    },
  },
  {
    pattern: /^\/sponsors(?:[/?]|$)/,
    title: "Sponsor access",
    lede: "Sign in with the address your sponsorship is registered to, or start with it below.",
    startHint: "Start with your sponsor contact email. We confirm it is yours and open your sponsorship.",
    startLabel: "Continue with your email",
    emailFlow: "representation",
  },
];

/** The flow a sign-in returns to, when one describes itself. */
export function signInDestination(returnPath: string | undefined): SignInDestination | null {
  if (!returnPath) return null;
  return SIGN_IN_DESTINATIONS.find((destination) => destination.pattern.test(returnPath)) ?? null;
}
