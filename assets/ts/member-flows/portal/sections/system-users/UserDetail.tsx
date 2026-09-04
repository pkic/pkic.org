import { useCallback, useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { deleteJson, getJson, postJson, requestJson } from "../../../../shared/api-client";
import { confirmHeadshotUsage } from "../../../../shared/headshot/controller";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../../../shared/headshot/AdminHeadshotManager";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { userAnonymizeResponseSchema, userDetailResponseSchema } from "../../../../../shared/schemas/user-management";
import { userGravatarImportResponseSchema } from "../../../../../shared/schemas/route-contracts-headshots";
import { fmt, toast } from "../../ui";
import { UserEmailAddressesPanel } from "./UserAccountPanels";
import {
  MemberAvailabilityPanel,
  MemberPrivacyPanel,
  MemberSkillsPanel,
  MemberStandingPanel,
} from "./UserMemberProfilePanels";
import { UserAdministrationSection } from "./UserAdministrationSection";
import { UserAffiliationsPanel } from "./UserAffiliationsPanel";
import { UserParticipationHistory } from "./UserParticipationHistory";
import { UserProfileEditor } from "./UserProfileEditor";
import type { UserDetail as UserDetailModel } from "./model";
import { Badge, statusLabel } from "../../../../components/Badge";
import { usePortalHashLocation } from "../../hash-location";
import { Alert } from "../../../../ui/Alert";
import { Avatar } from "../../../../ui/Avatar";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import {
  userParticipationResponseSchema,
  type UserGroupParticipation,
  type UserParticipation,
} from "../../../../../shared/schemas/user-participation";
import { Button } from "../../../../ui/Button";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { LinkList } from "../../../../ui/LinkList";
import { Meter } from "../../../../ui/Meter";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
// `pk-datalist`, `pk-break` and `pk-nowrap`'s neighbours ship in a component
// chunk rather than the entry stylesheet, so the module that writes those
// class names is the one that has to pull the sheet in.
import "../../../../ui/Content.css";

/*
 * Attendance tone thresholds. Product policy, not a system decision: the
 * design system's Meter takes a tone and says nothing about what counts as
 * good attendance for this consortium.
 */
function attendanceTone(attended: number, held: number): "ok" | "warn" | "danger" {
  const rate = held === 0 ? 0 : attended / held;
  if (rate >= 0.75) return "ok";
  if (rate >= 0.5) return "warn";
  return "danger";
}

/** The headline rate, or an em dash while no meeting has been held. */
function attendanceHeadline(participation: UserParticipation | null): string {
  if (!participation || participation.summary.meetingsHeld === 0) return "—";
  return `${String(Math.round((participation.summary.meetingsAttended / participation.summary.meetingsHeld) * 100))}%`;
}

export interface UserPermissions {
  canRead: boolean;
  canWrite: boolean;
  canGrantAccess: boolean;
  canAnonymize: boolean;
  canManageMembership: boolean;
  canActivateIdentity: boolean;
}

export function UserDetail({
  userId,
  permissions,
  viewerUserId,
}: {
  userId: string;
  permissions: UserPermissions;
  /** Who is reading, so the record knows when its subject is them. */
  viewerUserId?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDetailModel | null>(null);
  const [headshotStatus, setHeadshotStatus] = useState("");
  const [anonymizing, setAnonymizing] = useState(false);
  // Participation is its own resource: it is the expensive half of the record
  // and answers a different question from the detail, so it loads separately
  // and the rest of the page does not wait on it.
  const [participation, setParticipation] = useState<UserParticipation | null>(null);

  const load = useCallback(async () => {
    if (!permissions.canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(`/api/v1/users/${encodeURIComponent(userId)}`, userDetailResponseSchema);
      setUser(data.user);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [permissions.canRead, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!permissions.canRead) return;
    let cancelled = false;
    void getJson(`/api/v1/users/${encodeURIComponent(userId)}/participation`, userParticipationResponseSchema)
      .then((data) => {
        if (!cancelled) setParticipation(data.participation);
      })
      .catch(() => {
        // A record still reads without its participation; the panels below
        // simply do not appear rather than the page failing to load.
        if (!cancelled) setParticipation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [permissions.canRead, userId]);

  async function uploadHeadshot(file: Blob) {
    if (!user) return;
    await requestJson(`/api/v1/users/${encodeURIComponent(user.id)}/headshot`, successResponseSchema, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  }

  async function fetchGravatar() {
    if (!user) return;
    const accepted = await confirmHeadshotUsage({
      title: "Before uploading a photo",
      texts: ADMIN_HEADSHOT_DISCLAIMER,
      confirmText: "Proceed",
    });
    if (!accepted) return;
    setHeadshotStatus("Looking up Gravatar…");
    try {
      await postJson(`/api/v1/users/${encodeURIComponent(user.id)}/gravatar`, {}, userGravatarImportResponseSchema);
      toast("Gravatar imported successfully", "success");
      await load();
    } catch (cause) {
      const message = (cause as Error).message;
      toast(message, "error");
      setHeadshotStatus(`Error: ${message}`);
    }
  }

  async function anonymize() {
    if (!user) return;
    const confirmed = await confirmAction({
      title: `Anonymize ${user.email}?`,
      body: "This is permanent and cannot be undone.",
      consequences: [
        "Their name, email, biography, links, and headshot are permanently erased",
        "Their sign-in access is revoked immediately",
        "Their membership and event history records are kept, but no longer identify them",
      ],
      confirmLabel: "Anonymize user",
      typedConfirmation: user.email,
    });
    if (!confirmed) return;
    setAnonymizing(true);
    try {
      await postJson(`/api/v1/users/${encodeURIComponent(user.id)}/anonymize`, {}, userAnonymizeResponseSchema);
      toast("User anonymized", "success");
      await load();
    } catch (cause) {
      toast((cause as Error).message, "error");
    } finally {
      setAnonymizing(false);
    }
  }

  if (!permissions.canRead) {
    return <ErrorAlert error="You need Users read permission to open a user record." />;
  }
  if (loading) return <Spinner label="Loading user…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!user) return null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const editable = permissions.canWrite && !user.pii_redacted_at;
  /*
   * A record about the reader offers different things than one about somebody
   * else. Nobody messages themselves, follows themselves, or vouches for their
   * own skills — the last of those is a rule the write path already enforces,
   * and offering a control whose only outcome is a refusal is worse than not
   * offering it.
   */
  const isSelf = viewerUserId !== undefined && viewerUserId === user.id;

  /*
   * What the person actually does lives on their membership identity, not on
   * the account: the job title, the organization it is held through, the
   * biography, and the groups they sit in. The record is about the person, so
   * that identity is what the header and the About panel speak from — the
   * account fields (role, active, created) are administrative and belong in
   * the aside.
   */
  const identity =
    user.identities.find((entry) => entry.isDefault) ??
    user.identities.find((entry) => entry.organizationId !== null) ??
    user.identities[0];
  const identityCount = user.identities.length;

  const lede = [identity?.jobTitle, identity?.organizationName].filter(Boolean).join(" at ") || undefined;

  const participationGroups = participation?.groups ?? [];

  /*
   * This table is now the record's whole statement of which groups the person
   * sits in: a chip shelf above it said the same names with none of the
   * standing, the role, or the attendance beside them.
   *
   * The attendance column is a Meter, not a hand-built bar: it is the same
   * proportion the design system already draws, at the in-cell size. A group
   * with no meetings yet shows a dash — there is no rate to report, and 0%
   * would accuse someone of missing meetings that were never held.
   */
  const groupColumns: DataTableColumn<UserGroupParticipation>[] = [
    {
      id: "group",
      header: "Group",
      width: "primary",
      cell: (row) => <span class="pk-strong">{row.group.name}</span>,
    },
    { id: "type", header: "Type", width: "fit", cell: (row) => row.group.type.singularLabel },
    {
      id: "title",
      header: "Role",
      width: "fit",
      cell: (row) => (row.title ? <Badge status={row.title} /> : <span class="pk-muted">Member</span>),
    },
    {
      id: "attendance",
      header: "Attendance",
      width: "fit",
      cell: (row) =>
        row.held === 0 ? (
          <span class="pk-muted">—</span>
        ) : (
          <Meter
            size="sm"
            showValue
            label={`${String(row.attended)} of ${String(row.held)} meetings attended`}
            value={row.attended}
            max={row.held}
            tone={attendanceTone(row.attended, row.held)}
          />
        ),
    },
    {
      id: "lastAttended",
      header: "Last attended",
      width: "fit",
      cell: (row) => (row.lastAttendedAt ? <span class="pk-nowrap">{fmt(row.lastAttendedAt)}</span> : "—"),
    },
  ];

  /** Copying the link is the one share affordance that needs no new feature. */
  async function copyRecordLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Record link copied", "success");
    } catch {
      // Clipboard access is refused in some browsers and every insecure
      // context; say so rather than leaving the reader wondering.
      toast("Your browser would not let the page copy the link", "error");
    }
  }

  const recordActions: MenuItem[] = [{ id: "copy", label: "Copy record link", onSelect: () => void copyRecordLink() }];
  if (permissions.canAnonymize && !user.pii_redacted_at) {
    recordActions.push({
      id: "anonymize",
      label: anonymizing ? "Anonymizing…" : "Anonymize user…",
      danger: true,
      separatorBefore: true,
      disabled: anonymizing,
      onSelect: () => void anonymize(),
    });
  }

  /*
   * Two lists, two questions. Contact answers "how do I reach this person",
   * which is what the address is for; Account answers "what is this record",
   * which is names, role and dates. The address appeared in both until the
   * Contact card existed, and a fact stated twice on one page is a fact the
   * reader has to check for agreement.
   */
  const contactEmail = identity?.email ?? user.email;
  const contactFacts: DescriptionListItem[] = [{ term: "Email", value: <span class="pk-break">{contactEmail}</span> }];

  const accountFacts: DescriptionListItem[] = [
    // Restated only when the sign-in address is not the one above it, which is
    // the case that would otherwise be invisible.
    ...(contactEmail === user.email
      ? []
      : [{ term: "Sign-in email", value: <span class="pk-break">{user.email}</span> }]),
    { term: "First name", value: user.first_name },
    { term: "Last name", value: user.last_name },
    { term: "Preferred name", value: user.preferred_name },
    { term: "Role", value: <Badge status={user.role} /> },
    { term: "Active", value: user.active ? "Yes" : "No" },
    { term: "Created", value: <span class="pk-nowrap">{fmt(user.created_at)}</span> },
  ];

  return (
    <div class="pk pk-stack">
      {/*
        A record about a person opens with the person, not with a page title.
        `PageHeader` names a place in the portal; `ProfileHeader` names the
        subject the record is about, which is what a contact view is for — the
        portrait leads, the standing is worn on it, and the identifying facts
        sit under the name rather than in a field list further down.

        The trail stays its own control: it is navigation, not part of who this
        person is, and keeping it out of the header is what lets the same
        header carry an organization on the organization record.
      */}
      <Breadcrumb items={[{ label: "Users", href: usePortalHashLocation.hrefs("/users") }, { label: displayName }]} />
      <ProfileHeader
        media={
          <Avatar
            name={displayName}
            src={user.headshotUrl ?? undefined}
            size="xl"
            // The role is worn on the portrait; `neutral` desaturates it for a
            // deactivated account, so the standing reads as held-before
            // without a second badge saying so.
            status={{ label: statusLabel(user.role), tone: user.active ? "accent" : "neutral" }}
          />
        }
        title={displayName}
        pill={user.active ? undefined : <Badge status="inactive" />}
        lede={lede}
        facts={[user.email, `Created ${fmt(user.created_at)}`, user.pii_redacted_at ? "Anonymized" : null].filter(
          (fact): fact is string => Boolean(fact),
        )}
        /*
         * Message and Follow are on the record because this is a community
         * profile and they are part of what it will offer — but they are
         * disabled, with the reason on the control itself, because neither has
         * a domain behind it yet: there is no messaging schema and no follow
         * relation. A disabled control states an intention; an enabled one
         * that quietly does nothing states a lie.
         *
         * `title` carries the reason to a pointer, `aria-describedby` would
         * need an id per button, so the accessible name carries it too.
         */
        actions={
          <>
            {!isSelf && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  disabled
                  title="Messaging is not available yet"
                  aria-label="Message — not available yet"
                >
                  Message
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled
                  title="Following members is not available yet"
                  aria-label="Follow — not available yet"
                >
                  Follow
                </Button>
              </>
            )}
            <Menu label="Record actions" align="end" items={recordActions}>
              <span aria-hidden="true">⋯</span>
            </Menu>
          </>
        }
      />

      {user.pii_redacted_at && (
        /* The redaction used to be a red date in the table, which is a state
           told by colour alone. The words carry it now and the tone only
           reinforces them. */
        <Alert tone="danger" title="This account has been anonymized">
          Personal details were erased on {fmt(user.pii_redacted_at)} and cannot be restored. The membership and event
          records that remain no longer identify this person.
        </Alert>
      )}

      {/*
        The record's two columns: what the person does on the left, what the
        account is on the right. `pk-record` is the system's record layout, so
        this page is arranged the same way every other subject record is —
        one column under 60rem, main plus a measured aside above it.
      */}
      <div class="pk-record">
        <div class="pk-stack">
          {/*
            About speaks from the identity marked as default.

            The only prose this system stores is `identity.biography`, which
            describes what somebody does at one organization. Which of those
            represents the person is theirs to say, so it is marked rather than
            guessed — and the affiliation that supplied this text does not
            repeat it below, or the same paragraph would appear twice on one
            page. With nothing marked the record falls back to the first
            affiliation, which is what it did before the flag existed.
          */}
          {identity?.biography && (
            <Panel aria-label="About">
              <PanelHeader title="About" />
              <PanelBody>
                <p class="pk-affiliation__summary">{identity.biography}</p>
              </PanelBody>
            </Panel>
          )}

          <MemberSkillsPanel userId={user.id} canRead={permissions.canRead} canVouch={!isSelf} />

          {participationGroups.length > 0 && (
            <div class="pk-table-list">
              <DataTable
                caption="Group participation"
                showCaption
                columns={groupColumns}
                rows={participationGroups}
                rowKey={(row) => row.group.id}
              />
            </div>
          )}

          {/* One panel for the ties themselves: it states each affiliation and
              carries the controls that manage it, rather than stating them
              here and restating them as management cards below. */}
          <UserAffiliationsPanel
            user={user}
            onChanged={load}
            canManage={permissions.canManageMembership}
            canActivate={permissions.canActivateIdentity}
            summarizedIdentityId={identity?.identityId}
          />

          <UserParticipationHistory userId={user.id} canRead={permissions.canRead} />

          {/* Operations on the account rather than statements about the
              person, so they are disclosed under the record instead of
              reading as three more things it says. */}
          <UserAdministrationSection>
            {editable && (
              <Panel>
                <PanelHeader title="Profile" />
                <PanelBody>
                  <UserProfileEditor user={user} canGrantAccess={permissions.canGrantAccess} onSaved={load} />
                </PanelBody>
              </Panel>
            )}

            <UserEmailAddressesPanel userId={user.id} primaryEmail={user.email} canWrite={permissions.canWrite} />

            <Panel>
              <PanelHeader title="Photo" />
              <PanelBody>
                <AdminHeadshotManager
                  initialUrl={user.headshotUrl}
                  alt="Headshot"
                  emptyLabel="User"
                  statusText={headshotStatus}
                  readOnly={!editable}
                  uploadHeadshot={uploadHeadshot}
                  deleteHeadshot={async () => {
                    await deleteJson(`/api/v1/users/${encodeURIComponent(user.id)}/headshot`, successResponseSchema);
                  }}
                  onFetchGravatar={editable ? fetchGravatar : undefined}
                  onUploaded={async () => {
                    toast("Headshot uploaded", "success");
                    await load();
                  }}
                  onDeleted={async () => {
                    toast("Headshot removed", "success");
                    await load();
                  }}
                  onError={(message) => toast(message, "error")}
                  confirmDeleteMessage="Remove this user's headshot?"
                />
              </PanelBody>
            </Panel>
          </UserAdministrationSection>
        </div>

        <aside class="pk-stack">
          <MemberAvailabilityPanel
            userId={user.id}
            canRead={permissions.canRead}
            canWrite={editable}
            contactEmail={contactEmail}
          />
          <MemberStandingPanel userId={user.id} canRead={permissions.canRead} />

          <Panel aria-label="At a glance">
            <PanelHeader title="At a glance" />
            <PanelBody class="pk-stack pk-stack--snug">
              {/* `pk-figure-row`, not `pk-grid`: three figures in an 18rem
                  aside fall under any sensible track minimum, and a grid that
                  folds turns a glance into a column three tiles tall. */}
              <div class="pk-figure-row">
                <StatCard
                  density="compact"
                  label="groups"
                  value={String(participation?.summary.groupCount ?? identityCount)}
                />
                <StatCard density="compact" label="events" value={String(participation?.summary.eventCount ?? 0)} />
                <StatCard density="compact" label="attendance" value={attendanceHeadline(participation)} />
              </div>
              {participation && participation.summary.meetingsHeld > 0 && (
                <p class="pk-small pk-muted pk-footnote">
                  {participation.summary.meetingsAttended} of {participation.summary.meetingsHeld} meetings attended
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel aria-label="Account">
            <PanelHeader title="Account" />
            <PanelBody>
              {/* One record's fields as a description list rather than an
                  unnamed table, on a page that already has several tables. */}
              <DescriptionList density="compact" items={accountFacts} />
            </PanelBody>
          </Panel>

          <Panel aria-label="Contact">
            <PanelHeader title="Contact" />
            <PanelBody class="pk-stack pk-stack--snug">
              {/*
                The address is stated because a reader holding Users access can
                already see it. What the design offers instead — reaching
                someone through the portal without being handed their address —
                needs the messaging domain that does not exist yet.
              */}
              <DescriptionList density="compact" items={contactFacts} />
              <LinkList links={identity?.links ?? []} />
            </PanelBody>
          </Panel>

          <MemberPrivacyPanel identities={user.identities} availability={null} canWrite={editable} />
        </aside>
      </div>
    </div>
  );
}
