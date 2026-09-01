/**
 * One place where errors become sentences. Raw transport phrasing ("HTTP
 * 403") and machine codes never reach the reader: known situations get real
 * copy, and anything unrecognized keeps its message but is stated plainly.
 */
import { Alert } from "../ui/Alert";

interface ErrorAlertProps {
  error: string | Error | null | undefined;
}

const FRIENDLY_BY_STATUS: Record<string, string> = {
  "HTTP 401": "Your session has ended. Sign in again to continue.",
  "HTTP 403": "You don't have access to this. If you think you should, ask an administrator.",
  "HTTP 404": "This wasn't found. It may have been removed, or the link may be out of date.",
  "HTTP 409": "Someone else changed this at the same time. Reload to see the latest version.",
  "HTTP 429": "Too many attempts in a short time. Wait a moment and try again.",
  "HTTP 500": "Something went wrong on our side. Try again, and let us know if it keeps happening.",
  "HTTP 502": "The service didn't respond. Try again in a moment.",
  "HTTP 503": "The service is temporarily unavailable. Try again in a moment.",
};

export function friendlyErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  const exact = FRIENDLY_BY_STATUS[trimmed];
  if (exact) return exact;
  // Messages like "HTTP 503" with trailing detail keep their mapped lead.
  const status = /^HTTP (\d{3})\b/.exec(trimmed)?.[0];
  if (status && FRIENDLY_BY_STATUS[status]) return FRIENDLY_BY_STATUS[status];
  return trimmed;
}

export function ErrorAlert({ error }: ErrorAlertProps) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : error;
  return (
    <div class="pk">
      <Alert tone="danger">{friendlyErrorMessage(message)}</Alert>
    </div>
  );
}
