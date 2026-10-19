import { useEffect, useState } from "preact/hooks";
import { ApiClientError } from "../shared/api-client";
import { useAsyncSubmission } from "./useAsyncSubmission";

/**
 * Owns the enumeration-safe request state shared by magic-link forms.
 *
 * `resendCooldownSeconds` holds a sent link for that long before another may
 * be requested, so a reader waiting for the email is not tempted to send a
 * stream of links that invalidate each other; `secondsUntilResend` counts it
 * down for the button that says so.
 */
export function useMagicLinkRequest(fallbackError: string, { resendCooldownSeconds = 0 } = {}) {
  const [sent, setSent] = useState(false);
  const [secondsUntilResend, setSecondsUntilResend] = useState(0);
  const submission = useAsyncSubmission();

  useEffect(() => {
    if (secondsUntilResend <= 0) return;
    const timer = setTimeout(() => setSecondsUntilResend((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [secondsUntilResend]);

  async function request(action: () => Promise<void>): Promise<boolean> {
    if (secondsUntilResend > 0) return false;
    submission.begin();
    try {
      await action();
      setSent(true);
      setSecondsUntilResend(resendCooldownSeconds);
      return true;
    } catch (error) {
      submission.setError(error instanceof ApiClientError ? error.message : fallbackError);
      return false;
    } finally {
      submission.finish();
    }
  }

  function clearFeedback(): void {
    setSent(false);
    setSecondsUntilResend(0);
    submission.setError(null);
  }

  return { sent, secondsUntilResend, request, clearFeedback, ...submission };
}
