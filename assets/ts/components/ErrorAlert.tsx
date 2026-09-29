/**
 * One place where errors become sentences. Raw transport phrasing ("HTTP
 * 403") and machine codes never reach the reader: known situations get real
 * copy, and anything unrecognized keeps its message but is stated plainly.
 */
import { ZodError } from "zod";
import { Alert } from "../ui/Alert";

interface ErrorAlertProps {
  error: string | Error | null | undefined;
}

/**
 * What a reader is told when a response fails its contract.
 *
 * A `ZodError`'s own message is the issue list as JSON, and every list in the
 * portal validates its response through the shared collection controller — so
 * without this, one unexpected column reaches staff as a wall of
 * `"code": "invalid_value"`. There is nothing the reader can do about it
 * beyond trying again and telling someone, so that is what it says.
 */
const MALFORMED_RESPONSE =
  "The server sent a response this page could not read. Try again, and let us know if it keeps happening.";

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

/**
 * A `ZodError`'s `message` is its issue list serialized as JSON, and it
 * reaches this helper as a plain string wherever a surface caught the error
 * and kept only its text. Issue #13 is what that looks like to a reader: the
 * members page rendered several hundred lines of
 * `{"expected":"string","code":"invalid_type","path":["members",0,"slug"]…}`
 * across the whole width of the site.
 *
 * Recognizing the shape here rather than only in `ErrorAlert` means the
 * fourteen surfaces that render `friendlyErrorMessage` into an alert of their
 * own are covered too — a reader never sees a validator's working, whichever
 * path the failure took to reach the screen.
 */
function isSerializedValidationIssues(text: string): boolean {
  if (!text.startsWith("[") && !text.startsWith("{")) return false;
  return /"code"\s*:\s*"invalid_/.test(text) || /"path"\s*:\s*\[/.test(text);
}

export function friendlyErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (isSerializedValidationIssues(trimmed)) return MALFORMED_RESPONSE;
  const exact = FRIENDLY_BY_STATUS[trimmed];
  if (exact) return exact;
  // Messages like "HTTP 503" with trailing detail keep their mapped lead.
  const status = /^HTTP (\d{3})\b/.exec(trimmed)?.[0];
  if (status && FRIENDLY_BY_STATUS[status]) return FRIENDLY_BY_STATUS[status];
  return trimmed;
}

export function ErrorAlert({ error }: ErrorAlertProps) {
  if (!error) return null;
  const message = error instanceof ZodError ? MALFORMED_RESPONSE : error instanceof Error ? error.message : error;
  return (
    <div class="pk">
      <Alert tone="danger">{friendlyErrorMessage(message)}</Alert>
    </div>
  );
}
