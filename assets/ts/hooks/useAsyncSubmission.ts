import { useCallback, useState } from "preact/hooks";

/** Shared state transitions for asynchronous forms that expose one error. */
export function useAsyncSubmission() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(() => {
    setError(null);
    setSubmitting(true);
  }, []);
  const finish = useCallback(() => setSubmitting(false), []);

  return { submitting, error, begin, finish, setError };
}
