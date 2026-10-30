/**
 * The page an MCP client sends a person to before it may act for them. It is
 * the whole page, so it carries its own `.pk` root: sign-in first, then the
 * consent itself, where the person chooses which of the permissions they can
 * delegate the client receives and as which identity.
 *
 * Approval is accepted, then completed in the background; the page waits for
 * the completion and follows its redirect back to the client.
 */
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
import { myProfileSchema } from "../../../../shared/schemas/me";
import {
  oauthAuthorizationApprovalResponseSchema,
  oauthAuthorizationCompletionSchema,
} from "../../../../shared/schemas/oauth-authorizations";
import { userAuthEstablishedResponseSchema, userAuthSessionResponseSchema } from "../../../../shared/schemas/user-auth";
import { sessionActingIdentityChoiceRequired } from "../../../../shared/session-acting-identity";
import { VerifyingOverlay } from "../../../components/VerifyingOverlay";
import { useContractForm } from "../../../hooks/useContractForm";
import { actingIdentityLabel, PERSONAL_IDENTITY_LABEL } from "../../../shared/acting-identity-catalog";
import { ApiClientError, getJson, requestJson } from "../../../shared/api-client";
import { authenticateWithPasskey } from "../../../shared/passkey-authentication";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { TextInput } from "../../../ui/TextControl";
import { accountDisplayName, saveProfile } from "../state";
import type { PortalSession } from "../types";
import { ActingIdentitySwitcher } from "./ActingIdentitySwitcher";
import { rememberedSelection, rememberSelection } from "./consent-selection";
import { type ConsentAccount, McpConsent } from "./McpConsent";
import { SignedInHeaderMenu } from "./SignedInHeaderMenu";

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

async function submitOauthDenial(returnTo: string): Promise<string> {
  const data = await requestJson(OAUTH_AUTHORIZE_PATH, mcpOauthRedirectResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(mcpOauthAuthorizeActionSchema.parse({ action: "deny", return_to: returnTo })),
  });
  return data.redirectTo;
}

const COMPLETION_POLL_MS = 500;
const COMPLETION_ATTEMPTS = 60;
const APPROVAL_FAILED = "The authorization could not be completed. Please try again.";

/** Approve, then wait for the background completion and return where it redirects. */
async function submitOauthApproval(
  returnTo: string,
  scopes: readonly string[],
  actingIdentityId: string | null,
): Promise<string> {
  const accepted = await requestJson(OAUTH_AUTHORIZE_PATH, oauthAuthorizationApprovalResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(
      mcpOauthAuthorizeActionSchema.parse({ action: "approve", return_to: returnTo, scopes, actingIdentityId }),
    ),
  });
  for (let attempt = 0; attempt < COMPLETION_ATTEMPTS; attempt += 1) {
    const result = await getJson(
      `/api/v1/auth/oauth/authorizations/${encodeURIComponent(accepted.authorizationId)}/completion`,
      oauthAuthorizationCompletionSchema,
    );
    if (result.status === "active") return result.redirectTo;
    if (result.status !== "pending") throw new Error(APPROVAL_FAILED);
    await new Promise((resolve) => setTimeout(resolve, COMPLETION_POLL_MS));
  }
  throw new Error(APPROVAL_FAILED);
}

/** Who is granting the access, read from the session and the person's own profile. */
async function loadConsentAccount(): Promise<{ session: PortalSession; account: ConsentAccount }> {
  const [session, person] = await Promise.all([
    getJson("/api/v1/auth/session", userAuthSessionResponseSchema),
    getJson("/api/v1/users/current", myProfileSchema),
  ]);
  const acting = session.actingIdentities.find((identity) => identity.id === session.actingIdentityId);
  // The site header shows the signed-in account from the shared profile, as it does after any sign-in.
  saveProfile(person);
  return {
    session,
    account: {
      name: accountDisplayName(person),
      email: session.identity.email,
      headshotUrl: person.headshotUrl ?? null,
      actingAs: acting ? actingIdentityLabel(acting) : PERSONAL_IDENTITY_LABEL,
    },
  };
}

/** Every permission the consent offers, in the catalog's order. */
function offeredScopes(context: McpOauthContext): string[] {
  return context.areas.flatMap((area) => area.permissions.map((item) => item.permission));
}

/** The chosen permissions in the catalog's order, so the request reads the way the screen does. */
function chosenScopes(context: McpOauthContext, selected: ReadonlySet<string>): string[] {
  return offeredScopes(context).filter((scope) => selected.has(scope));
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
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialReturnTo));
  const [verifying, setVerifying] = useState(Boolean(initialToken));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initial.get("error"));
  const [consent, setConsent] = useState<{ session: PortalSession; account: ConsentAccount } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  /* The consent starts from everything the client asked for that this person can delegate. */
  useEffect(() => {
    let cancelled = false;
    setConsent(null);
    if (!context?.authorized) return;
    setSelected(rememberedSelection(context.clientName, offeredScopes(context)));
    loadConsentAccount()
      .then((loaded) => {
        if (!cancelled) setConsent(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [context]);

  useEffect(() => {
    let cancelled = false;
    setReturnTo(initialReturnTo);
    setSent(false);
    setContext(null);
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

  async function refreshContext(): Promise<void> {
    setContext(null);
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
      setError(checked.formMessage);
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

  async function handleDecision(decide: () => Promise<string>): Promise<void> {
    if (!returnTo) return;
    setSubmitting(true);
    try {
      window.location.assign(await decide());
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await refreshContext();
      }
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const deny = () => void handleDecision(() => submitOauthDenial(returnTo));

  if (verifying || loading || (context?.authorized && !consent && !error)) {
    return <VerifyingOverlay />;
  }

  if (context?.authorized && consent) {
    if (sessionActingIdentityChoiceRequired(consent.session))
      return <ActingIdentitySwitcher session={consent.session} onChosen={() => refreshContext()} />;
    return (
      <>
        <SignedInHeaderMenu session={consent.session} />
        <McpConsent
          clientName={context.clientName}
          clientHost={context.redirectHost}
          account={consent.account}
          areas={context.areas}
          selected={selected}
          busy={submitting}
          onSelect={setSelected}
          onAuthorize={() =>
            void handleDecision(() => {
              rememberSelection(context.clientName, offeredScopes(context), selected);
              return submitOauthApproval(returnTo, chosenScopes(context, selected), consent.session.actingIdentityId);
            })
          }
          error={error}
          onCancel={deny}
        />
      </>
    );
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
                      loading={submitting}
                      disabled={submitting}
                      onClick={() => {
                        void handlePasskeySignIn();
                      }}
                    >
                      {submitting ? "Waiting for passkey…" : "Sign in with a passkey"}
                    </Button>
                    <p class="pk-small pk-muted">or</p>
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
                  <Button type="submit" variant="primary" loading={submitting} disabled={submitting || !returnTo}>
                    {submitting ? "Sending…" : "Send sign-in link"}
                  </Button>
                </form>
              </>
            )
          ) : context.authorized ? null : (
            <>
              <Alert tone="warn" title={`Signed in as ${context.userEmail ?? "an unknown account"}`}>
                This account does not have permission to authorize MCP access.
              </Alert>
              <Button disabled={submitting} onClick={deny}>
                Deny and go back
              </Button>
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </Panel>
    </div>
  );
}
