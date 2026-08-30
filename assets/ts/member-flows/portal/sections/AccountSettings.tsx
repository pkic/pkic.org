/** Member account email, access summary, shared passkey management, and notifications. */
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { PasskeySettings } from "../../../components/passkey-settings";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { ApiClientError, getJson, patchJson } from "../../../shared/api-client";
import { portalSession, profile } from "../state";
import type { NotificationPreferences, PortalSession } from "../types";
import { toast } from "../ui";
import { myNotificationPreferencesSchema } from "../../../../shared/schemas/me";

const PREFERENCE_LABELS: Record<keyof NotificationPreferences, string> = {
  workingGroupUpdates: "Working group updates",
  voteReminders: "Vote reminders",
  generalAnnouncements: "General consortium announcements",
  wgChairMembershipDigest: "Working group roster change digest (chairs & vice-chairs only, weekly)",
};

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
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Notification preferences</div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        {!preferences && !error ? (
          <Spinner />
        ) : (
          preferences && (
            <div class="d-flex flex-column gap-2">
              {(Object.keys(PREFERENCE_LABELS) as Array<keyof NotificationPreferences>).map((key) => (
                <div class="form-check form-switch" key={key}>
                  <input
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    id={`portal-notif-${key}`}
                    checked={preferences[key]}
                    disabled={savingKey === key}
                    onChange={(event) => void toggle(key, (event.target as HTMLInputElement).checked)}
                  />
                  <label class="form-check-label small" for={`portal-notif-${key}`}>
                    {PREFERENCE_LABELS[key]}
                  </label>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
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
  const memberships = session.member ? (profile.value?.activeMemberships ?? []) : [];
  const staff = session.staff;

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Your access</div>
      <div class="card-body d-flex flex-column gap-3">
        {memberships.length > 0 && (
          <div>
            <h6 class="small fw-semibold text-muted text-uppercase">Member capacities</h6>
            <ul class="list-unstyled mb-0 d-flex flex-column gap-1">
              {memberships.map((membership) => (
                <li key={membership.memberId} class="small">
                  {membership.organizationId ? (
                    <Link href={`/organizations/${encodeURIComponent(membership.organizationId)}`}>
                      {membership.organizationName ?? "Organization"}
                    </Link>
                  ) : (
                    "Individual membership"
                  )}
                  <span class="badge text-bg-light ms-2">Category {membership.membershipCategory}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {staff && (
          <div>
            <h6 class="small fw-semibold text-muted text-uppercase">Staff access</h6>
            {staff.role === "admin" ? (
              <p class="small mb-0">Administrator — this account holds every administrative permission.</p>
            ) : staff.grants.length === 0 ? (
              <p class="small mb-0">No individual permissions are granted to this account.</p>
            ) : (
              <ul class="list-unstyled mb-0 d-flex flex-column gap-1">
                {staff.grants.map((grant) => (
                  <li key={`${grant.permission}:${grant.contextType ?? ""}:${grant.contextId ?? ""}`} class="small">
                    <code>{grant.permission}</code>
                    <span class="text-muted ms-2">{grantScopeLabel(grant)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {session.sponsors.length > 0 && (
          <div>
            <h6 class="small fw-semibold text-muted text-uppercase">Sponsor access</h6>
            <ul class="list-unstyled mb-0 d-flex flex-column gap-1">
              {session.sponsors.map((sponsor) => (
                <li key={`${sponsor.sponsorId}:${sponsor.eventId}`} class="small">
                  {sponsor.eventName ?? sponsor.eventSlug}
                  <span class="badge text-bg-light ms-2">{sponsor.tier}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p class="text-muted small mb-0">
          Group participation and leadership are managed per group; open a group from the sidebar to see what you can do
          there.
        </p>
      </div>
    </div>
  );
}

export function AccountSettings() {
  const session = portalSession.value;
  const hasMemberCapacity = Boolean(session?.member);
  const email = profile.value?.email || session?.identity.email || "";

  return (
    <div class="d-flex flex-column gap-3 content-width-md">
      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">Email</div>
        <div class="card-body">
          <p class="mb-0">{email}</p>
          <p class="text-muted small mb-0">
            {hasMemberCapacity
              ? "This is the verified primary email address for your account. Contact PKI Consortium staff to change it."
              : "This is the verified primary email address for your portal identity."}
          </p>
        </div>
      </div>

      {session && <AccessSummaryCard session={session} />}
      <PasskeySettings toastTargetId="portal-toast-area" />
      {hasMemberCapacity && <NotificationPreferencesCard />}
    </div>
  );
}
