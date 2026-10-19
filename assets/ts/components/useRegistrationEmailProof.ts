import { useCallback, useEffect, useState } from "preact/hooks";
import {
  registrationEmailProofVerifyResponseSchema,
  registrationEmailProofVerifySchema,
  type RegistrationEmailProofVerifyResponse,
} from "../../shared/schemas/registration-email-proof";
import { postJson } from "../shared/api-client";

/** A verified address, and the link that proves it, which the registration carries when submitted. */
export type VerifiedRegistrationEmail = RegistrationEmailProofVerifyResponse & { token: string };

const STORAGE_KEY = "pkic.registration.emailProof";

function storageKey(): string {
  return `${STORAGE_KEY}:${location.pathname}`;
}

/** The link's token, taken out of the address bar so the page can be shared or bookmarked without it. */
function takeTokenFromLocation(): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get("verify");
  if (!token) return null;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return token;
}

function remembered(): string | null {
  try {
    return sessionStorage.getItem(storageKey());
  } catch {
    return null;
  }
}

function remember(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(storageKey(), token);
    else sessionStorage.removeItem(storageKey());
  } catch {
    // Without storage, a reload asks for the address again; nothing else depends on it.
  }
}

/** A registration made with the proof ends it: the next registration in this tab starts from the email again. */
export function forgetRegistrationEmailProof(): void {
  remember(null);
}

/**
 * Opening the emailed link lands on the registration form with `#verify=`.
 * The token is read once, kept for this tab so a reload continues where the
 * person was, and exchanged for the verified address and what the form still
 * asks. `forget` returns to the email step.
 */
export function useRegistrationEmailProof(verifyUrl: string) {
  const [verified, setVerified] = useState<VerifiedRegistrationEmail | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const verify = (token: string, fromLink: boolean) => {
      setVerifying(true);
      setError(null);
      postJson(
        verifyUrl,
        registrationEmailProofVerifySchema.parse({ token }),
        registrationEmailProofVerifyResponseSchema,
      )
        .then((result) => {
          if (!current) return;
          remember(token);
          setVerified({ ...result, token });
        })
        .catch((caught: unknown) => {
          if (!current) return;
          remember(null);
          // A stale reload simply starts over; a link that fails says why.
          if (fromLink) setError(caught instanceof Error ? caught.message : "We could not verify this link.");
        })
        .finally(() => current && setVerifying(false));
    };
    const fromLink = takeTokenFromLocation();
    const token = fromLink ?? remembered();
    if (token) verify(token, Boolean(fromLink));
    // The link may also open in the tab already showing this form, which changes only the fragment.
    const onHashChange = () => {
      const opened = takeTokenFromLocation();
      if (opened) verify(opened, true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      current = false;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [verifyUrl]);

  const forget = useCallback(() => {
    remember(null);
    setVerified(null);
    setError(null);
  }, []);

  return { verified, verifying, error, forget };
}
