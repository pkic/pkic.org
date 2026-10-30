import { useEffect, useState } from "preact/hooks";
import { rateLimitErrorDetailsSchema } from "../../shared/schemas/api-common";
import { ApiClientError } from "../shared/api-client";
import { useAsyncSubmission } from "./useAsyncSubmission";

/**
 * A throttled request sent nothing, so the reader is told how long to wait
 * instead of the generic refusal; the wait comes from the 429's `retryAfter`.
 */
function magicLinkRequestErrorMessage(error: unknown, fallbackError: string): string {
  if (!(error instanceof ApiClientError)) return fallbackError;
  const throttle = error.status === 429 ? rateLimitErrorDetailsSchema.safeParse(error.details) : null;
  if (!throttle?.success) return error.message;
  const minutes = Math.max(1, Math.ceil(throttle.data.retryAfter / 60));
  return `Too many links requested. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

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
      submission.setError(magicLinkRequestErrorMessage(error, fallbackError));
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
