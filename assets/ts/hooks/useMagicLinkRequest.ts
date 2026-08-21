import { useState } from "preact/hooks";
import { ApiClientError } from "../shared/api-client";
import { useAsyncSubmission } from "./useAsyncSubmission";

/** Owns the enumeration-safe request state shared by magic-link forms. */
export function useMagicLinkRequest(fallbackError: string) {
  const [sent, setSent] = useState(false);
  const submission = useAsyncSubmission();

  async function request(action: () => Promise<void>): Promise<boolean> {
    submission.begin();
    try {
      await action();
      setSent(true);
      return true;
    } catch (error) {
      submission.setError(error instanceof ApiClientError ? error.message : fallbackError);
      return false;
    } finally {
      submission.finish();
    }
  }

  return { sent, request, ...submission };
}
