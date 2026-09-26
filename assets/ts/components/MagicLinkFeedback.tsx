/**
 * The two pieces of feedback a magic-link sign-in form shows: the state of
 * the send, and why it failed.
 *
 * Both are the design system's now. Neither wraps itself in a `.pk` root:
 * they are parts of somebody else's form, not regions of their own, and
 * `pk-btn` and `pk-alert` describe themselves without one.
 */
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";

export function MagicLinkSubmitButton({ submitting }: { submitting: boolean }) {
  // `loading` adds the spinner and aria-busy; `disabled` is what actually
  // stops a second submit, because a submit button posts its form on click
  // whether or not the component ignored the handler.
  return (
    <Button type="submit" variant="primary" block loading={submitting} disabled={submitting}>
      {submitting ? "Sending…" : "Send sign-in link"}
    </Button>
  );
}

/**
 * The failure. It used to open with a bare "✕", which a screen reader reads
 * out as a character and which was the only thing besides the red telling a
 * reader this was a failure at all. The Alert's danger tone and `role="alert"`
 * do that job, and the sentence still says "Sign-in failed".
 */
export function SignInError({ error, includePrefix = true }: { error: string | null; includePrefix?: boolean }) {
  if (!error) return null;
  return <Alert tone="danger">{includePrefix ? `Sign-in failed: ${error}` : error}</Alert>;
}
