import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  mcpOauthContextSchema,
  mcpOauthMagicLinkResponseSchema,
  mcpOauthRedirectResponseSchema,
} from "../../../../shared/schemas/mcp-oauth";
import { userAuthEstablishedResponseSchema } from "../../../../shared/schemas/user-auth";
import { VerifyingOverlay } from "../../../components/VerifyingOverlay";
import { requestJson } from "../../../shared/api-client";
import { authenticateWithPasskey } from "../../../shared/passkey-authentication";
import { emailFromSubmitEvent } from "../../../shared/form/helpers";

const OAUTH_AUTHORIZE_PATH = "/api/v1/auth/oauth/authorize";

type McpOauthContext = z.infer<typeof mcpOauthContextSchema>;

function authorizationParameters(hash: string): URLSearchParams {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

async function fetchOauthContext(returnTo: string): Promise<McpOauthContext> {
  return requestJson(`${OAUTH_AUTHORIZE_PATH}?return_to=${encodeURIComponent(returnTo)}`, mcpOauthContextSchema, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
}

async function requestOauthMagicLink(email: string, returnTo: string): Promise<void> {
  await requestJson(OAUTH_AUTHORIZE_PATH, mcpOauthMagicLinkResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: "request-link", email, return_to: returnTo }),
  });
}

async function verifyUserMagicLink(token: string): Promise<void> {
  await requestJson("/api/v1/auth/verify-link", userAuthEstablishedResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
}

async function submitOauthDecision(action: "approve" | "deny", returnTo: string): Promise<string> {
  const data = await requestJson(OAUTH_AUTHORIZE_PATH, mcpOauthRedirectResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, return_to: returnTo }),
  });
  return data.redirectTo;
}

function authorizationHash(returnTo: string): string {
  return `#/auth/oauth?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

export function McpAuthorization() {
  const initial = authorizationParameters(window.location.hash);
  const initialReturnTo = initial.get("return_to") ?? "";
  const initialToken = initial.get("token") ?? "";
  const [returnTo, setReturnTo] = useState(initialReturnTo);
  const [context, setContext] = useState<McpOauthContext | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialReturnTo));
  const [verifying, setVerifying] = useState(Boolean(initialToken));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initial.get("error"));
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  useEffect(() => {
    if (!initialToken) return;

    verifyUserMagicLink(initialToken)
      .then(() => {
        history.replaceState({}, "", `/portal/${authorizationHash(initialReturnTo)}`);
        setError(null);
      })
      .catch((err: unknown) => {
        setError((err as Error).message);
      })
      .finally(() => {
        setVerifying(false);
      });
  }, [initialReturnTo, initialToken]);

  useEffect(() => {
    if (!returnTo || verifying) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchOauthContext(returnTo)
      .then((data) => {
        setContext(data);
        setReturnTo(data.returnTo);
        setError(null);
      })
      .catch((err: unknown) => {
        setError((err as Error).message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [returnTo, verifying]);

  async function refreshContext(): Promise<void> {
    setLoading(true);
    try {
      const data = await fetchOauthContext(returnTo);
      setContext(data);
      setReturnTo(data.returnTo);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: Event): Promise<void> {
    const email = emailFromSubmitEvent(event);
    if (!email || !returnTo) return;
    setSubmitting(true);
    try {
      await requestOauthMagicLink(email, returnTo);
      setSent(true);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasskeySignIn(): Promise<void> {
    setSubmitting(true);
    try {
      await authenticateWithPasskey();
      await refreshContext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecision(action: "approve" | "deny"): Promise<void> {
    if (!returnTo) return;
    setSubmitting(true);
    try {
      window.location.assign(await submitOauthDecision(action, returnTo));
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (verifying || loading) {
    return <VerifyingOverlay />;
  }

  return (
    <div class="d-flex justify-content-center py-5">
      <div class="card shadow-sm content-width-sm">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">Authorize MCP access</h2>
          <p class="text-muted">
            {context?.clientName
              ? `${context.clientName} is requesting access to the PKI Consortium API.`
              : "Sign in through the portal to review this authorization request."}
          </p>

          {!context?.authenticated ? (
            sent ? (
              <div class="alert alert-success mt-3">
                ✓ If this address has staff access, you'll receive a sign-in link shortly.
              </div>
            ) : (
              <>
                {passkeysSupported && (
                  <>
                    <button
                      type="button"
                      class="btn btn-outline-success w-100 mb-3"
                      disabled={submitting}
                      onClick={() => {
                        void handlePasskeySignIn();
                      }}
                    >
                      {submitting ? "Waiting for passkey…" : "Sign in with a passkey"}
                    </button>
                    <div class="text-center text-muted small mb-3">or</div>
                  </>
                )}
                <form
                  onSubmit={(event) => {
                    void handleSubmit(event);
                  }}
                >
                  <div class="mb-3">
                    <label class="form-label fw-semibold" for="mcp-oauth-email">
                      Portal email
                    </label>
                    <input
                      class="form-control"
                      type="email"
                      id="mcp-oauth-email"
                      name="email"
                      required
                      autocomplete="email"
                    />
                  </div>
                  <button type="submit" class="btn btn-success w-100" disabled={submitting || !returnTo}>
                    {submitting ? "Sending…" : "Send sign-in link"}
                  </button>
                </form>
              </>
            )
          ) : !context.authorized ? (
            <div class="d-grid gap-3">
              <div class="alert alert-warning mb-0">
                <div class="fw-semibold">Signed in as {context.userEmail}</div>
                <div>This account does not have permission to authorize MCP access.</div>
              </div>
              <button
                type="button"
                class="btn btn-outline-secondary"
                disabled={submitting}
                onClick={() => {
                  void handleDecision("deny");
                }}
              >
                Deny and return to client
              </button>
            </div>
          ) : (
            <div class="d-grid gap-3">
              <div class="alert alert-light border mb-0">
                <div class="fw-semibold">Signed in as {context.staffEmail}</div>
                <div class="small text-muted">Client: {context.clientName}</div>
              </div>
              <div>
                <div class="fw-semibold mb-2">Requested permissions</div>
                <ul class="mb-2">
                  {context.requestedScopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div class="fw-semibold mb-2">Granted permissions</div>
                {context.grantedScopes.length > 0 ? (
                  <ul class="mb-0">
                    {context.grantedScopes.map((scope) => (
                      <li key={scope}>{scope}</li>
                    ))}
                  </ul>
                ) : (
                  <p class="text-muted mb-0">No requested permissions can be granted by this account.</p>
                )}
              </div>
              <div class="d-grid gap-2">
                <button
                  type="button"
                  class="btn btn-success"
                  disabled={submitting || context.grantedScopes.length === 0}
                  onClick={() => {
                    void handleDecision("approve");
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  disabled={submitting}
                  onClick={() => {
                    void handleDecision("deny");
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          {error && <div class="alert alert-danger mt-3">{error}</div>}
        </div>
      </div>
    </div>
  );
}
