import { Spinner } from "./Spinner";

/**
 * The wait while a sign-in link is exchanged for a session.
 *
 * This is the shared Spinner with the sign-in wording, not a second spinner.
 * The Bootstrap version drew its own `spinner-border` and put the sentence in
 * a sibling `text-muted` paragraph, which left the role="status" region
 * empty: the circle was announced as busy and the words explaining the wait
 * were not part of it. Handing the message to Spinner as its label puts them
 * in the same region.
 */
export function VerifyingOverlay({ message = "Verifying your sign-in link…" }: { message?: string }) {
  return <Spinner label={message} />;
}
