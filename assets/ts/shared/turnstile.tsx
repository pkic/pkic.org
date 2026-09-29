import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { TurnstileChallenge } from "../../shared/schemas/abuse-protection";
import { Dialog } from "../ui/Dialog";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "auto";
      retry: "never";
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
      "timeout-callback"(): void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const timeout = window.setTimeout(failed, 15_000);
    function failed() {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Could not load verification. Please try again."));
    }
    script.onerror = failed;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else failed();
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

function ChallengeDialog({ challenge, settle }: { challenge: TurnstileChallenge; settle(token: string | null): void }) {
  const container = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState("A quick verification helps us prevent automated abuse.");
  useEffect(() => {
    let disposed = false;
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    const failed = () => {
      setToken(null);
      setMessage("Verification failed or expired. Cancel and submit the form again.");
    };
    void loadTurnstile()
      .then((loaded) => {
        if (disposed || !container.current) return;
        api = loaded;
        widgetId = api.render(container.current, {
          sitekey: challenge.siteKey,
          action: challenge.action,
          theme: "auto",
          retry: "never",
          callback: setToken,
          "error-callback": failed,
          "expired-callback": () => {
            setToken(null);
            setMessage("Verification expired. Please verify again to continue.");
            if (widgetId !== undefined) api?.reset(widgetId);
          },
          "timeout-callback": failed,
        });
      })
      .catch(() => {
        if (!disposed) failed();
      });
    return () => {
      disposed = true;
      if (api && widgetId !== undefined) api.remove(widgetId);
    };
  }, [challenge]);
  return (
    <Dialog
      open
      title="Verify to continue"
      description={message}
      confirmLabel="Continue"
      confirmDisabled={!token}
      onConfirm={() => settle(token)}
      onCancel={() => settle(null)}
    >
      <div ref={container} />
    </Dialog>
  );
}

/** One disposable widget per attempt: tokens are never cached or shared across requests. */
export function requestTurnstileToken(challenge: TurnstileChallenge, signal?: AbortSignal | null): Promise<string> {
  if (signal?.aborted) return Promise.reject(new Error("Verification canceled."));
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    document.body.append(host);
    const cancel = () => settle(null);
    function settle(token: string | null) {
      signal?.removeEventListener("abort", cancel);
      render(null, host);
      host.remove();
      if (token) resolve(token);
      else reject(new Error("Verification canceled. Your form has not been submitted."));
    }
    signal?.addEventListener("abort", cancel, { once: true });
    render(<ChallengeDialog challenge={challenge} settle={settle} />, host);
  });
}
