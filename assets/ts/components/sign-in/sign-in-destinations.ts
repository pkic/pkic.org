/**
 * What the sign-in card says about the flow a person arrived for.
 *
 * Signing in is one screen for every flow, and it stays ignorant of them: a
 * flow describes itself here in words, and may hand the card its own progress
 * component to show what it takes. The card draws what it is handed. A return
 * path no flow claims gets the plain sign-in card.
 *
 * A flow is reached two ways: its public page on this site, which embeds the
 * card, and its portal route, for an event without a public page. Both return
 * paths name the same flow.
 */
import { signInEventSlug, signInPurpose } from "../../../shared/sign-in-purpose";
import type { SignInDestination } from "./sign-in-destination";

const RETURNING_OR_NEW = "Been here before? Sign in. New here? Start with your email below.";

const SIGN_IN_DESTINATIONS: readonly SignInDestination[] = [
  {
    matches: (returnPath) => signInPurpose(returnPath)?.flow === "registration",
    title: "Register for this event",
    lede: RETURNING_OR_NEW,
    startHint: "Start with your email. We confirm it is yours and take you straight to registration.",
    startLabel: "Start registration",
    emailFlow: "registration",
    load: async (returnPath) => {
      const registration = await import("../events/registration-sign-in");
      const slug = signInEventSlug(returnPath, "registration");
      const name = slug ? await registration.registrationEventName(slug) : null;
      return { Progress: registration.RegistrationProgress, title: name ? `Register for ${name}` : undefined };
    },
  },
  {
    matches: (returnPath) => signInPurpose(returnPath)?.flow === "proposal",
    title: "Submit a proposal",
    lede: RETURNING_OR_NEW,
    startHint: "Start with your email. We confirm it is yours and take you straight to your proposal.",
    startLabel: "Start your proposal",
    emailFlow: "proposal",
  },
  {
    matches: (returnPath) => signInPurpose(returnPath)?.flow === "join",
    title: "Join the PKI Consortium",
    lede: RETURNING_OR_NEW,
    startHint: "Start with your email. We confirm it is yours and take you straight to your membership application.",
    startLabel: "Start your application",
    emailFlow: "join",
  },
  {
    matches: (returnPath) => /^\/sponsors(?:[/?]|$)/.test(returnPath),
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
  return SIGN_IN_DESTINATIONS.find((destination) => destination.matches(returnPath)) ?? null;
}
