import { OAuthPermissionSelection, readOnlyPermissionScopes } from "./OAuthPermissionSelection";
import type { Permission } from "../../../../shared/schemas/permissions";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useEffect, useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import type { z } from "zod";
import {
  mcpOauthAuthorizeActionSchema,
  mcpOauthContextSchema,
  mcpOauthMagicLinkResponseSchema,
  mcpOauthRedirectResponseSchema,
} from "../../../../shared/schemas/mcp-oauth";
import { userAuthEstablishedResponseSchema } from "../../../../shared/schemas/user-auth";
import { VerifyingOverlay } from "../../../components/VerifyingOverlay";
import { useContractForm } from "../../../hooks/useContractForm";
import { ApiClientError, requestJson } from "../../../shared/api-client";
import { authenticateWithPasskey } from "../../../shared/passkey-authentication";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { TextInput } from "../../../ui/TextControl";
// `pk-datalist`, `pk-answer-list`: component CSS ships in lazy chunks, so a
// module that writes these class names has to pull their stylesheet in itself.
import "../../../ui/Content.css";

const OAUTH_AUTHORIZE_PATH = "/api/v1/auth/oauth/authorize";

type McpOauthContext = z.infer<typeof mcpOauthContextSchema>;
type McpOauthAuthorizeAction = z.infer<typeof mcpOauthAuthorizeActionSchema>;

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

async function requestOauthMagicLink(body: McpOauthAuthorizeAction): Promise<void> {
  await requestJson(OAUTH_AUTHORIZE_PATH, mcpOauthMagicLinkResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
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

async function submitOauthDecision(body: McpOauthAuthorizeAction): Promise<string> {
  const data = await requestJson(OAUTH_AUTHORIZE_PATH, mcpOauthRedirectResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  return data.redirectTo;
}

function authorizationHash(returnTo: string): string {
  return `#/auth/oauth?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

export function McpAuthorization() {
  const [authorizationLocation] = useHashLocation();
  const initial = authorizationParameters(authorizationLocation);
  const initialReturnTo = initial.get("return_to") ?? "";
  const initialToken = initial.get("token") ?? "";
  const [returnTo, setReturnTo] = useState(initialReturnTo);
  const [context, setContext] = useState<McpOauthContext | null>(null);
  const [email, setEmail] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Permission[]>([]);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialReturnTo));
  const [verifying, setVerifying] = useState(Boolean(initialToken));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initial.get("error"));
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  useEffect(() => {
    let cancelled = false;
    setReturnTo(initialReturnTo);
    setContext(null);
    setSelectedScopes([]);
    setSent(false);
    if (!initialReturnTo) {
      setLoading(false);
      return;
    }

    async function loadAuthorization(): Promise<void> {
      setLoading(true);
      setVerifying(Boolean(initialToken));
      try {
        if (initialToken) {
          await verifyUserMagicLink(initialToken);
          if (cancelled) return;
          history.replaceState({}, "", `/portal/${authorizationHash(initialReturnTo)}`);
        }
        const data = await fetchOauthContext(initialReturnTo);
        if (cancelled) return;
        setContext(data);
        setSelectedScopes(readOnlyPermissionScopes(data.grantedScopes));
        setReturnTo(data.returnTo);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) {
          setVerifying(false);
          setLoading(false);
        }
      }
    }

    void loadAuthorization();
    return () => {
      cancelled = true;
    };
  }, [initialReturnTo, initialToken]);

  async function refreshContext(preserveSelection = false): Promise<void> {
    setContext(null);
    setLoading(true);
    try {
      const data = await fetchOauthContext(returnTo);
      setContext(data);
      setSelectedScopes((previous) =>
        preserveSelection
          ? previous.filter((scope) => data.grantedScopes.includes(scope))
          : readOnlyPermissionScopes(data.grantedScopes),
      );
      setReturnTo(data.returnTo);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /*
   * One basis for validation: the contract the authorize route parses. The
   * address used to be read back out of the DOM and checked with `if (!email)
   * return`, which silently did nothing — a malformed address left the button
   * looking broken rather than marking the field.
   */
  const form = useContractForm(mcpOauthAuthorizeActionSchema, {
    action: "request-link",
    email: email.trim(),
    return_to: returnTo,
  });

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSubmitting(true);
    try {
      await requestOauthMagicLink(checked.data);
      setSent(true);
      setError(null);
    } catch (err) {
      // A server refusal names its fields the way the contract does.
      setError(form.refuse(err));
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

  const decisionForm = useContractForm(mcpOauthAuthorizeActionSchema, {
    action: "approve",
    return_to: returnTo,
    scopes: selectedScopes,
  });

  async function handleDecision(action: "approve" | "deny"): Promise<void> {
    if (!returnTo) return;
    let body: McpOauthAuthorizeAction = { action: "deny", return_to: returnTo };
    if (action === "approve") {
      const checked = decisionForm.submit();
      if (!checked.data) {
        setError(checked.message);
        return;
      }
      body = checked.data;
    }
    setSubmitting(true);
    try {
      window.location.assign(await submitOauthDecision(body));
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        await refreshContext(true);
      }
      setError(decisionForm.refuse(err));
      setSubmitting(false);
    }
  }

  if (verifying || loading) {
    return <VerifyingOverlay />;
  }

  return (
    <div class="pk pk-container pk-section pk-cluster pk-cluster--center">
      <Panel class="content-width-sm">
        <PanelHeader title="Authorize MCP access" headingLevel={2} />
        <PanelBody class="pk-stack">
          <p class="pk-muted">
            {context?.clientName
              ? `${context.clientName} is requesting access to the PKI Consortium API.`
              : "Sign in through the portal to review this authorization request."}
          </p>

          {!context?.authenticated ? (
            sent ? (
              <Alert tone="ok">If this address has staff access, you&apos;ll receive a sign-in link shortly.</Alert>
            ) : (
              <>
                {passkeysSupported && (
                  <>
                    <Button
                      block
                      loading={submitting}
                      disabled={submitting}
                      onClick={() => {
                        void handlePasskeySignIn();
                      }}
                    >
                      {submitting ? "Waiting for passkey…" : "Sign in with a passkey"}
                    </Button>
                    <p class="pk-small pk-center">or</p>
                  </>
                )}
                <form
                  noValidate
                  class="pk-stack"
                  {...form.handlers}
                  onSubmit={(event) => {
                    void handleSubmit(event);
                  }}
                >
                  <Field label="Portal email" required {...form.of("email")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        type="email"
                        name="email"
                        autocomplete="email"
                        value={email}
                        onInput={(event) => setEmail(event.currentTarget.value)}
                      />
                    )}
                  </Field>
                  <Button type="submit" variant="primary" block loading={submitting} disabled={submitting || !returnTo}>
                    {submitting ? "Sending…" : "Send sign-in link"}
                  </Button>
                </form>
              </>
            )
          ) : !context.authorized ? (
            <>
              <Alert tone="warn" title={`Signed in as ${context.userEmail ?? "an unknown account"}`}>
                This account does not have permission to authorize MCP access.
              </Alert>
              <Button
                block
                disabled={submitting}
                onClick={() => {
                  void handleDecision("deny");
                }}
              >
                Deny and return to client
              </Button>
            </>
          ) : (
            <>
              <dl class="pk-datalist pk-small">
                <dt>Signed in as</dt>
                <dd>{context.staffEmail}</dd>
                <dt>Client</dt>
                <dd>{context.clientName}</dd>
              </dl>

              <form
                noValidate
                class="pk-stack"
                {...decisionForm.handlers}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleDecision("approve");
                }}
              >
                <p class="pk-small pk-muted">
                  Choose what this client may do. Read-only permissions are selected by default. Write access can change
                  forms, organizations, or users. Resource limits remain in effect.
                </p>
                <OAuthPermissionSelection
                  requested={context.requestedScopes}
                  available={context.grantedScopes}
                  selected={selectedScopes}
                  grants={context.grantableGrants}
                  disabled={submitting}
                  onChange={setSelectedScopes}
                />
                <div class="pk-stack pk-stack--snug">
                  <Button type="submit" variant="primary" block disabled={submitting || selectedScopes.length === 0}>
                    Approve
                  </Button>
                  <Button
                    block
                    disabled={submitting}
                    onClick={() => {
                      void handleDecision("deny");
                    }}
                  >
                    Deny
                  </Button>
                </div>
              </form>
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </Panel>
    </div>
  );
}
