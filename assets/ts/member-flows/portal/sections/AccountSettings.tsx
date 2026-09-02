/** Member account email, access summary, shared passkey management, and notifications. */
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { PasskeySettings } from "../../../components/passkey-settings";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { Button } from "../../../ui/Button";
import { Checkbox } from "../../../ui/Checkbox";
import { Badge } from "../../../ui/Badge";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { ApiClientError, getJson, patchJson } from "../../../shared/api-client";
import { portalSession, profile } from "../state";
import type { NotificationPreferences, PortalSession } from "../types";
import { toast } from "../ui";
import { useMembershipCategoryLabels } from "../../../hooks/useMembershipCategoryLabels";
import { myNotificationPreferencesSchema } from "../../../../shared/schemas/me";
import {
  identitiesListResponseSchema,
  identityMutationResponseSchema,
  type ActingIdentity,
} from "../../../../shared/schemas/identity";

const PREFERENCE_LABELS: Record<keyof NotificationPreferences, string> = {
  workingGroupUpdates: "Working group updates",
  voteReminders: "Vote reminders",
  generalAnnouncements: "General consortium announcements",
  wgChairMembershipDigest: "Working group roster change digest (chairs & vice-chairs only, weekly)",
};

function IdentityInvitationsCard() {
  const [invitations, setInvitations] = useState<ActingIdentity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);

  useEffect(() => {
    getJson("/api/v1/users/current/identities?active=false&limit=100", identitiesListResponseSchema)
      .then((response) => setInvitations(response.identities.filter((identity) => identity.state === "pending")))
      .catch((reason: unknown) =>
        setError(reason instanceof ApiClientError ? reason.message : "Could not load identity invitations."),
      );
  }, []);

  async function accept(identity: ActingIdentity): Promise<void> {
    setAccepting(identity.id);
    try {
      await patchJson(
        `/api/v1/users/current/identities/${encodeURIComponent(identity.id)}`,
        { transition: { state: "active" } },
        identityMutationResponseSchema,
      );
      toast(`Identity for ${identity.organizationName ?? "the organization"} accepted`, "success");
      window.location.reload();
    } catch (reason) {
      toast(reason instanceof ApiClientError ? reason.message : "Could not accept the identity invitation.", "error");
      setAccepting(null);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Identity invitations" />
      <PanelBody class="pk-stack pk-stack--snug">
        {error && <ErrorAlert error={error} />}
        {!invitations && !error && <Spinner />}
        {invitations?.length === 0 && <p class="pk-muted pk-small">No pending identity invitations.</p>}
        {invitations && invitations.length > 0 && (
          <div class="pk-stack pk-stack--snug">
            {invitations.map((identity) => (
              <div class="pk-cluster pk-cluster--between" key={identity.id}>
                <div>
                  <strong>{identity.organizationName}</strong>
                  <div class="pk-small pk-muted">Accept to receive Member and group access in this exact capacity.</div>
                </div>
                <Button variant="primary" size="sm" disabled={accepting !== null} onClick={() => void accept(identity)}>
                  {accepting === identity.id ? "Accepting…" : "Accept identity"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    getJson("/api/v1/users/current/notifications/preferences", myNotificationPreferencesSchema)
      .then(setPreferences)
      .catch((reason: unknown) =>
        setError(reason instanceof ApiClientError ? reason.message : "Could not load preferences."),
      );
  }, []);

  async function toggle(key: keyof NotificationPreferences, next: boolean): Promise<void> {
    setSavingKey(key);
    try {
      const updated = await patchJson(
        "/api/v1/users/current/notifications/preferences",
        { [key]: next },
        myNotificationPreferencesSchema,
      );
      setPreferences(updated);
    } catch (reason) {
      toast(reason instanceof ApiClientError ? reason.message : "Could not update preference.", "error");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Notification preferences" />
      <PanelBody class="pk-stack pk-stack--snug">
        {error && <ErrorAlert error={error} />}
        {!preferences && !error ? (
          <Spinner />
        ) : (
          preferences && (
            <div class="pk-stack pk-stack--snug">
              {(Object.keys(PREFERENCE_LABELS) as Array<keyof NotificationPreferences>).map((key) => (
                <Checkbox
                  key={key}
                  role="switch"
                  id={`portal-notif-${key}`}
                  checked={preferences[key]}
                  disabled={savingKey === key}
                  onChange={(event) => void toggle(key, (event.target as HTMLInputElement).checked)}
                  label={<span class="pk-small">{PREFERENCE_LABELS[key]}</span>}
                />
              ))}
            </div>
          )
        )}
      </PanelBody>
    </Panel>
  );
}

function grantScopeLabel(grant: { contextType: string | null; contextId: string | null }): string {
  if (grant.contextType === null) return "global";
  return grant.contextId ? `${grant.contextType} ${grant.contextId}` : grant.contextType;
}

/**
 * The identity's roles and permissions live here, not in the navigation:
 * the menu navigates, while this view explains what the account may do.
 */
function AccessSummaryCard({ session }: { session: PortalSession }) {
  const memberships = session.member ? (profile.value?.activeIdentities ?? []) : [];
  const staff = session.staff;
  const categories = useMembershipCategoryLabels(memberships.length > 0);

  return (
    <Panel>
      <PanelHeader title="Your access" />
      <PanelBody class="pk-stack pk-stack--snug">
        {memberships.length > 0 && (
          <div>
            <h6 class="pk-small pk-strong pk-muted">Member capacities</h6>
            <ul class="pk-stack pk-stack--tight">
              {memberships.map((membership) => (
                <li key={membership.identityId} class="pk-small">
                  {membership.organizationId ? (
                    <Link href={`/organizations/${encodeURIComponent(membership.organizationId)}`}>
                      {membership.organizationName ?? "Organization"}
                    </Link>
                  ) : (
                    "Individual membership"
                  )}
                  {/* The category speaks its catalog label — a bare code told
                      a member nothing about their own standing. Plain text,
                      not a Badge: the pill's nowrap would push a long catalog
                      label past a phone's edge. */}
                  <span class="pk-muted"> — {categories.label(membership.membershipCategory)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {staff && (
          <div>
            <h6 class="pk-small pk-strong pk-muted">Permissions</h6>
            {staff.role === "admin" ? (
              <p class="pk-small">Administrator — this account holds every administrative permission.</p>
            ) : staff.grants.length === 0 ? (
              <p class="pk-small">No individual permissions are granted to this account.</p>
            ) : (
              <ul class="pk-stack pk-stack--tight">
                {staff.grants.map((grant) => (
                  <li key={`${grant.permission}:${grant.contextType ?? ""}:${grant.contextId ?? ""}`} class="pk-small">
                    <code>{grant.permission}</code>
                    <span class="pk-muted">{grantScopeLabel(grant)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {session.sponsors.length > 0 && (
          <div>
            <h6 class="pk-small pk-strong pk-muted">Sponsor access</h6>
            <ul class="pk-stack pk-stack--tight">
              {session.sponsors.map((sponsor) => (
                <li key={`${sponsor.sponsorId}:${sponsor.eventId}`} class="pk-small">
                  {sponsor.eventName ?? sponsor.eventSlug}
                  <Badge tone="neutral">{sponsor.tier}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p class="pk-muted pk-small">
          Group participation and leadership are managed per group; open a group from the sidebar to see what you can do
          there.
        </p>
      </PanelBody>
    </Panel>
  );
}

export function AccountSettings() {
  const session = portalSession.value;
  const hasMemberCapacity = Boolean(session?.member);
  const hasAccountSecurityCapacity = Boolean(session?.member || session?.staff);
  const email = profile.value?.email || session?.identity.email || "";

  return (
    <div class="pk pk-stack">
      <PageHeader title="Account Settings" />
      {session?.pendingIdentityCount ? <IdentityInvitationsCard /> : null}
      {/* The cards flow into the width the page affords rather than stacking
          down a capped column with the rest of the screen empty. */}
      <div class="pk-grid pk-grid--roomy">
        <Panel>
          <PanelHeader title="Email" />
          <PanelBody class="pk-stack pk-stack--snug">
            <p>{email}</p>
            <p class="pk-muted pk-small">
              {hasMemberCapacity
                ? "This is the verified primary email address for your account. Contact an administrator to change it."
                : "This is the verified primary email address for your portal identity."}
            </p>
          </PanelBody>
        </Panel>

        {session && <AccessSummaryCard session={session} />}
        {hasAccountSecurityCapacity && <PasskeySettings toastTargetId="portal-toast-area" />}
        {hasMemberCapacity && <NotificationPreferencesCard />}
      </div>
    </div>
  );
}
