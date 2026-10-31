import { personDisplayName } from "../../../../../shared/person-display";
import { Markdown } from "../../../../ui/Markdown";
import { RefreshNotice } from "../../../../components/RefreshNotice";
import { useData } from "../../../../hooks/useData";
import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { getJson } from "../../../../shared/api-client";
import { userDetailResponseSchema } from "../../../../../shared/schemas/user-management";
import { fmt } from "../../ui";
import { EmailAddressesPanel } from "./EmailAddressesPanel";
import { IdentityInvitationsPanel } from "./IdentityInvitationsPanel";
import { UserAccessPanel } from "./UserAccessPanel";
import { PasskeySettings } from "../../../../components/passkey-settings";
import { NotificationPreferencesCard } from "../NotificationPreferencesCard";
import {
  MemberAvailabilityPanel,
  MemberPrivacyPanel,
  MemberSkillsPanel,
  MemberStandingPanel,
} from "./UserMemberProfilePanels";
import { UserAffiliationsPanel } from "./UserAffiliationsPanel";
import { identityProfileEditPath } from "./IdentityProfilePage";
import { UserParticipationHistory } from "./UserParticipationHistory";
import { UserProfileEditor } from "./UserProfileEditor";
import { CURRENT_USER_API } from "./current-user-api";
import { ActingIdentityPanel } from "./ActingIdentityPanel";
import { GroupAttendanceBar } from "./GroupAttendanceBar";
import { identityEntryName } from "./UserAffiliationRow";
import { SelfAccountNamesEditor } from "./SelfAccountNamesEditor";
import { portalSession, saveProfile } from "../../state";
import { myProfileSchema } from "../../../../../shared/schemas/me";
import { Badge } from "../../../../components/Badge";
import { usePortalHashLocation } from "../../hash-location";
import { Alert } from "../../../../ui/Alert";
import { Avatar } from "../../../../ui/Avatar";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import {
  userParticipationResponseSchema,
  type UserParticipation,
} from "../../../../../shared/schemas/user-participation";
import { UserPortrait } from "./UserPortrait";
import { useUserRecordCommands } from "./use-user-record-commands";
import { Menu } from "../../../../ui/Menu";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { userRecordFacts } from "./user-record-facts";
import { LinkList } from "../../../../ui/LinkList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
// `pk-datalist`, `pk-break` and `pk-nowrap`'s neighbours ship in a component
// chunk rather than the entry stylesheet, so the module that writes those
// class names is the one that has to pull the sheet in.
import "../../../../ui/Content.css";
import "./UserDetail.css";
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
  section,
  permissions,
  viewerUserId,
}: {
  userId: string;
  /**
   * A page under the record: `edit` opens the record with its profile fields open.
   */
  section?: string;
  permissions: UserPermissions;
  /** Who is reading, so the record knows when its subject is them. */
  viewerUserId?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const recordPath = `/users/${encodeURIComponent(userId)}`;
  // Participation is its own resource: it is the expensive half of the record
  // and answers a different question from the detail, so it loads separately
  // and the rest of the page does not wait on it.
  const [participation, setParticipation] = useState<UserParticipation | null>(null);
  /*
   * A record about the reader offers different things than one about somebody
   * else. Nobody messages themselves, follows themselves, or vouches for their
   * own skills — the last of those is a rule the write path already enforces,
   * and offering a control whose only outcome is a refusal is worse than not
   * offering it.
   *
   * It is settled from the address rather than from the loaded record, because
   * it also decides whether the record may be loaded at all: a member holds no
   * `users:read`, and their own record is the one page they can still open.
   */
  const isSelf = viewerUserId !== undefined && viewerUserId === userId;
  const session = portalSession.value;
  const canRead = permissions.canRead || isSelf;
  const {
    data: user,
    loading,
    error,
    updatedAt,
    reload: load,
  } = useData(async () => {
    if (!canRead) return null;
    const response = await getJson(`/api/v1/users/${encodeURIComponent(userId)}`, userDetailResponseSchema);
    return response.user;
  }, [canRead, userId]);

  const [participationVersion, setParticipationVersion] = useState(0);
  /** Reloads the record and the participation drawn beside it. */
  async function reload(): Promise<void> {
    await load();
    setParticipationVersion((version) => version + 1);
  }

  useEffect(() => {
    if (!canRead) return;
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
    // Each reload of the record re-reads it too: ending or reinstating an
    // identity closes or reopens the seats it lists.
  }, [canRead, userId, participationVersion]);

  /**
   * Re-reads the signed-in member's own profile after they change it.
   *
   * The record and the account menu draw the same person from two responses;
   * whichever one changed, the other has to be told, or the sidebar keeps
   * showing the portrait that was just replaced.
   */
  async function refreshSelfProfile(): Promise<void> {
    saveProfile(await getJson(CURRENT_USER_API, myProfileSchema));
    await reload();
  }

  // `/users/:id/edit` opens the record with its profile fields open: the edit view other pages link to.
  const [editingProfile, setEditingProfile] = useState(section === "edit");
  const editable = Boolean(user) && permissions.canWrite && !user?.pii_redacted_at;
  /*
   * The subject's own hold over their photo. It is not `editable`: a member
   * administers nobody, including themselves, yet their portrait has always
   * been theirs to set — it just used to be set on a page of its own.
   */
  const selfEditable = Boolean(user) && isSelf && !user?.pii_redacted_at;
  /*
   * The record's own commands. Hooks run on every render, before the record
   * may return early while it loads or is refused.
   */
  const recordActions = useUserRecordCommands({
    user,
    editable,
    selfEditable,
    canWrite: permissions.canWrite,
    canAnonymize: permissions.canAnonymize,
    editing: editingProfile,
    onEdit: () => setEditingProfile(true),
    onOpenProfile: () => navigate(`${recordPath}/profile`),
    reload: load,
  });

  if (!canRead) {
    return <ErrorAlert error="You need Users read permission to open a user record." />;
  }
  if (loading) return <Spinner label="Loading user…" />;
  if (error && !user) return <ErrorAlert error={error} />;
  if (!user) return null;

  const displayName = personDisplayName(
    { firstName: user.first_name, lastName: user.last_name, preferredName: user.preferred_name },
    user.email,
  );
  /*
   * Who may change the photograph. The same reach the photo panel has
   * always had — staff who may write the record, and the record's own
   * subject over their own likeness — now spent on the portrait itself.
   */
  const portraitEditable = editable || selfEditable;

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

  const personalIdentity = user.identities.find((entry) => entry.organizationId === null);
  const aboutIdentity = personalIdentity?.biography ? personalIdentity : identity;
  const aboutEditable = !user.pii_redacted_at && (isSelf || permissions.canManageMembership);
  const aboutActions = aboutEditable
    ? [
        ...(personalIdentity
          ? [
              {
                id: "about",
                label: personalIdentity.biography ? "Edit About you…" : "Add About you…",
                href: usePortalHashLocation.hrefs(identityProfileEditPath(user.id, personalIdentity.identityId)),
              },
            ]
          : []),
        ...(aboutIdentity?.organizationId
          ? [
              {
                id: "organization-bio",
                label: `Edit bio at ${aboutIdentity.organizationName}…`,
                href: usePortalHashLocation.hrefs(identityProfileEditPath(user.id, aboutIdentity.identityId)),
              },
            ]
          : []),
      ]
    : [];

  const actingEntry = isSelf
    ? user.identities.find((entry) => entry.identityId === session?.actingIdentityId)
    : undefined;

  const lede = [identity?.jobTitle, identity?.organizationName].filter(Boolean).join(" at ") || undefined;

  /*
   * Two lists, two questions. Contact answers "how do I reach this person",
   * which is what the address is for; Account answers "what is this record",
   * which is names, role and dates. The address appeared in both until the
   * Contact card existed, and a fact stated twice on one page is a fact the
   * reader has to check for agreement.
   */
  const { contactEmail, contactFacts, accountFacts } = userRecordFacts(user, identity, {
    // The subject's own card states and edits them instead.
    readerIsSubject: isSelf,
  });
  /* The figures read from participation alone. Until it loads — or when it is
     refused — there is nothing to count, which is a dash, not a guess. */
  const glanceFigure = (value: number | undefined) => (value === undefined ? "—" : String(value));

  return (
    <div class="pk pk-stack">
      {error && <RefreshNotice error={error} updatedAt={updatedAt} />}
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
      {!isSelf && (
        <Breadcrumb items={[{ label: "Users", href: usePortalHashLocation.hrefs("/users") }, { label: displayName }]} />
      )}
      <ProfileHeader
        media={
          /*
            The portrait is the control that changes it, for a reader who may
            (#28). A photograph used to be set only from a file input at the
            foot of the record under "Account administration"; here it is the
            face itself, the way every network the reader already uses does
            it. A reader who may not change it sees the portrait alone.

            The portrait carries no account status: an inactive account is the
            exception, and the badge beside the name says so.
          */
          portraitEditable ? (
            <UserPortrait
              userId={user.id}
              displayName={displayName}
              headshotUrl={user.headshotUrl ?? null}
              isSelf={isSelf}
              canEdit
              /* The subject's own portrait is read by the rest of the portal
                   from the stored profile, so their change re-reads that as
                   well as the record; everybody else's is only the record. */
              onChanged={isSelf ? refreshSelfProfile : reload}
            />
          ) : (
            <Avatar name={displayName} src={user.headshotUrl ?? undefined} size="xl" />
          )
        }
        title={displayName}
        pill={user.active ? undefined : <Badge status="inactive" />}
        lede={lede}
        /*
         * The address is only a fact when it is not already the title. A user
         * with no name is headed by their email, and repeating it on the line
         * underneath said the same string twice in a row — a third time in the
         * Contact card, which is where it belongs.
         */
        facts={[
          displayName === user.email ? null : user.email,
          isSelf ? null : `Created ${fmt(user.created_at)}`,
          user.pii_redacted_at ? "Anonymized" : null,
        ].filter((fact): fact is string => Boolean(fact))}
        actions={
          <Menu label="Record actions" align="end" items={recordActions}>
            <span aria-hidden="true">⋯</span>
          </Menu>
        }
      />

      {user.pii_redacted_at && (
        /* The redaction used to be a red date in the table, which is a state
           told by color alone. The words carry it now and the tone only
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
      <div class="pk-record pk-user-record">
        <div class="pk-stack pk-user-record__main">
          {isSelf ? <IdentityInvitationsPanel /> : null}

          {/* A personal introduction spans roles; otherwise About attributes the primary role's bio.
              Only the identity supplying About suppresses its repeated paragraph below. */}
          {(aboutIdentity?.biography || (personalIdentity && aboutEditable)) && (
            <Panel aria-label="About">
              <PanelHeader
                title="About"
                menu={aboutActions.length ? <Menu label="About actions" align="end" items={aboutActions} /> : undefined}
              />
              <PanelBody>
                {aboutIdentity?.organizationId && aboutIdentity.biography && (
                  <p class="pk-small pk-muted">From the {aboutIdentity.organizationName} profile.</p>
                )}
                {aboutIdentity?.biography ? (
                  <Markdown markdown={aboutIdentity.biography} className="pk-affiliation__summary" />
                ) : (
                  <p class="pk-muted">
                    {isSelf
                      ? "Add a general introduction covering your interests and roles."
                      : `${displayName} has not added a general introduction yet.`}
                  </p>
                )}
              </PanelBody>
            </Panel>
          )}

          <MemberSkillsPanel userId={user.id} canRead={canRead} canVouch={!isSelf} />

          {/* One panel for the ties themselves: it states each affiliation and
              carries the controls that manage it, rather than stating them
              here and restating them as management cards below. */}
          <UserAffiliationsPanel
            user={user}
            onChanged={isSelf ? refreshSelfProfile : reload}
            canManage={permissions.canManageMembership}
            canActivateIdentity={permissions.canActivateIdentity}
            summarizedIdentityId={aboutIdentity?.identityId}
            viewerIsSubject={isSelf}
            seats={participation?.groups ?? []}
            actingIdentityId={isSelf ? (session?.actingIdentityId ?? null) : null}
          />

          {permissions.canRead && <UserParticipationHistory userId={user.id} canRead={permissions.canRead} />}

          {/* The addresses the account answers to: the person manages their own,
              and staff with Users write permission manage a secondary address. */}
          {(isSelf || permissions.canWrite) && (
            <EmailAddressesPanel userId={user.id} isSelf={isSelf} primaryEmail={user.email} />
          )}

          {/* Email notifications are the person's own choice, made by nobody else. */}
          {isSelf && session?.member && <NotificationPreferencesCard />}
        </div>

        {/* Your own record says who you are acting as, with the switch beside it:
            at the head of the aside on a wide screen, and first of all on a
            narrow one, where the aside would otherwise put it below everything. */}
        {isSelf && session && session.actingIdentities.some((identity) => identity.id === session.actingIdentityId) && (
          <div class="pk-user-record__acting">
            <ActingIdentityPanel
              session={session}
              personName={displayName}
              identityName={actingEntry ? identityEntryName(actingEntry) : undefined}
            />
          </div>
        )}

        <div class="pk-stack pk-user-record__aside">
          <MemberAvailabilityPanel userId={user.id} canRead={canRead} canWrite={editable} contactEmail={contactEmail} />
          <MemberStandingPanel userId={user.id} canRead={canRead} />

          <Panel aria-label="At a glance">
            <PanelHeader title="At a glance" />
            <PanelBody class="pk-stack pk-stack--snug">
              {/* Not `pk-grid`: a grid that folds turns a glance into a
                  column three tiles tall. */}
              <div class="pk-user-glance-figures">
                <StatCard density="compact" label="groups" value={glanceFigure(participation?.summary.groupCount)} />
                <StatCard density="compact" label="events" value={glanceFigure(participation?.summary.eventCount)} />
                <StatCard density="compact" label="attendance" value={attendanceHeadline(participation)} />
              </div>
              {participation && <GroupAttendanceBar seats={participation.groups} />}
            </PanelBody>
          </Panel>

          {/*
            The record's account fields. A quick edit opens in a dialog from
            the panel's "…" menu (never inline); the panel always shows the facts.
          */}
          {(editable || selfEditable || accountFacts.length > 0) && (
            <Panel aria-label="Account">
              <PanelHeader title="Account">
                {(editable || selfEditable) && (
                  <Menu
                    label="Account actions"
                    align="end"
                    items={[
                      {
                        id: "edit",
                        label: isSelf && selfEditable ? "Edit names…" : "Edit account…",
                        onSelect: () => setEditingProfile(true),
                      },
                    ]}
                  />
                )}
              </PanelHeader>
              <PanelBody>
                {/* One record's fields as a description list rather than an
                   unnamed table, on a page that already has several tables. */}
                <DescriptionList density="compact" items={accountFacts} />
              </PanelBody>
              {isSelf && selfEditable && editingProfile ? (
                /* The person's names, through the member contract: nobody administers themselves. */
                <SelfAccountNamesEditor
                  user={user}
                  onClose={() => setEditingProfile(false)}
                  onSaved={refreshSelfProfile}
                />
              ) : editable && editingProfile ? (
                <UserProfileEditor
                  user={user}
                  canGrantAccess={permissions.canGrantAccess}
                  editing={editingProfile}
                  onClose={() => setEditingProfile(false)}
                  onSaved={load}
                />
              ) : null}
            </Panel>
          )}

          {/* Your own address already sits in Email addresses, and your links
                belong to each identity under Identity and experience. */}
          {!isSelf && (
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
          )}

          <MemberPrivacyPanel identities={user.identities} availability={null} canWrite={editable} />

          {isSelf && (session?.member || session?.staff) && <PasskeySettings toastTargetId="portal-toast-area" />}

          {(isSelf || permissions.canRead) && <UserAccessPanel user={user} session={isSelf ? session : null} />}
        </div>
      </div>
    </div>
  );
}
