/**
 * The consent screen an MCP client is sent to before it may act as a member of
 * staff. It is the whole page, so it carries its own `.pk` root.
 *
 * Three things the Bootstrap version could not say, and this one does:
 *
 *   - "Signed in as … / Client: …" was two bold `div`s inside a tinted box. It
 *     is a name/value pair, so it is a description list, and a reader can now
 *     tell which half is the label.
 *   - The unauthorized case is an `Alert` with the `warn` tone, whose
 *     `role="alert"` announces it. The old version carried its meaning in an
 *     amber background and nothing else.
 *   - The permission lists are headed by real `h3`s beneath the panel's `h2`,
 *     rather than by bold text that no heading navigation could reach. They
 *     take their size from `pk-small pk-strong` so the structure is honest
 *     without a sub-heading printing larger than the panel it sits in.
 */
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useEffect, useState } from "preact/hooks";
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
import { requestJson } from "../../../shared/api-client";
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
  const [email, setEmail] = useState("");
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

              <div class="pk-stack pk-stack--tight">
                <h3 class="pk-small pk-strong">Requested permissions</h3>
                <ul class="pk-answer-list">
                  {context.requestedScopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              </div>

              <div class="pk-stack pk-stack--tight">
                <h3 class="pk-small pk-strong">Granted permissions</h3>
                {context.grantedScopes.length > 0 ? (
                  <ul class="pk-answer-list">
                    {context.grantedScopes.map((scope) => (
                      <li key={scope}>{scope}</li>
                    ))}
                  </ul>
                ) : (
                  <p class="pk-muted">No requested permissions can be granted by this account.</p>
                )}
              </div>

              <div class="pk-stack pk-stack--snug">
                <Button
                  variant="primary"
                  block
                  disabled={submitting || context.grantedScopes.length === 0}
                  onClick={() => {
                    void handleDecision("approve");
                  }}
                >
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
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </Panel>
    </div>
  );
}
