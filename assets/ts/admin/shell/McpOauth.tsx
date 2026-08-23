import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  adminMcpOauthContextSchema,
  adminMcpOauthMagicLinkResponseSchema,
  adminMcpOauthRedirectResponseSchema,
  adminMcpOauthVerifyResponseSchema,
} from "../../../shared/schemas/admin-oauth";
import { requestJson } from "../../shared/api-client";

type McpOauthContext = z.infer<typeof adminMcpOauthContextSchema>;

async function fetchOauthContext(returnTo: string): Promise<McpOauthContext> {
  return requestJson(`/api/v1/oauth/authorize?return_to=${encodeURIComponent(returnTo)}`, adminMcpOauthContextSchema, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
}

async function requestOauthMagicLink(email: string, returnTo: string): Promise<void> {
  await requestJson("/api/v1/oauth/authorize", adminMcpOauthMagicLinkResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: "request-link", email, return_to: returnTo }),
  });
}

async function verifyOauthMagicLink(token: string): Promise<z.infer<typeof adminMcpOauthVerifyResponseSchema>> {
  return requestJson("/api/v1/oauth/verify-link", adminMcpOauthVerifyResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
}

async function submitOauthDecision(action: "approve" | "deny", returnTo: string): Promise<string> {
  const data = await requestJson("/api/v1/oauth/authorize", adminMcpOauthRedirectResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, return_to: returnTo }),
  });
  return data.redirectTo;
}

export function McpOauth() {
  const params = new URLSearchParams(window.location.search);
  const initialReturnTo = params.get("return_to") ?? "";
  const initialToken = params.get("token") ?? "";
  const initialError = params.get("error");

  const [returnTo, setReturnTo] = useState(initialReturnTo);
  const [context, setContext] = useState<McpOauthContext | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialReturnTo));
  const [verifying, setVerifying] = useState(Boolean(initialToken));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    if (!initialToken) {
      return;
    }

    verifyOauthMagicLink(initialToken)
      .then((data) => {
        const nextReturnTo = data.returnTo;
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("token");
        nextUrl.searchParams.set("return_to", nextReturnTo);
        history.replaceState({}, "", `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`);
        setReturnTo(nextReturnTo);
        setError(null);
      })
      .catch((err: unknown) => {
        setError((err as Error).message);
      })
      .finally(() => {
        setVerifying(false);
      });
  }, [initialToken]);

  useEffect(() => {
    if (!returnTo || verifying) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchOauthContext(returnTo)
      .then((data) => {
        setContext(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError((err as Error).message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [returnTo, verifying]);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
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
    return (
      <div id="verify-overlay">
        <div class="spinner-border text-success" role="status"></div>
        <p class="text-muted mb-0">
          {verifying ? "Verifying your sign-in link..." : "Loading authorization request..."}
        </p>
      </div>
    );
  }

  return (
    <div id="login-wrap">
      <div id="login-card">
        <h2>Authorize MCP Access</h2>
        <p class="sub">
          {context?.clientName
            ? `${context.clientName} is requesting access to the PKI Consortium MCP server.`
            : "Continue with your admin email to authorize this MCP client."}
        </p>

        {!context?.authenticated ? (
          sent ? (
            <div id="magic-sent" class="alert alert-success mt-3">
              ✓ If this address is registered, you'll receive a sign-in link shortly.
            </div>
          ) : (
            <form
              id="form-magic"
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <div class="mb-3">
                <label class="form-label fw-semibold" for="inp-email">
                  Admin email
                </label>
                <input
                  class="form-control"
                  type="email"
                  id="inp-email"
                  name="email"
                  placeholder="john.doe@example.com"
                  required
                  autocomplete="email"
                />
              </div>
              <button id="btn-send" type="submit" class="btn btn-success w-100" disabled={submitting || !returnTo}>
                {submitting ? "Sending..." : "Send sign-in link"}
              </button>
            </form>
          )
        ) : (
          <div class="d-grid gap-3">
            <div class="alert alert-light border mb-0">
              <div class="fw-semibold">Signed in as {context.adminEmail}</div>
              <div class="small text-muted">Client: {context.clientName}</div>
            </div>

            <div>
              <div class="fw-semibold mb-2">Requested scopes</div>
              <ul class="mb-2">
                {context.requestedScopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </div>

            <div>
              <div class="fw-semibold mb-2">Granted scopes</div>
              {context.grantedScopes.length > 0 ? (
                <ul class="mb-0">
                  {context.grantedScopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              ) : (
                <p class="text-muted mb-0">No scopes can be granted for this request.</p>
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
  );
}
