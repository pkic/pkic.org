import { useCallback, useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { getJson } from "../../../../shared/api-client";
import { userDetailResponseSchema } from "../../../../../shared/schemas/user-management";
import { fmt } from "../../ui";
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
import { CURRENT_USER_API, SelfProfilePanel } from "./SelfProfilePanel";
import { profile as profileSignal, saveProfile } from "../../state";
import { myProfileSchema } from "../../../../../shared/schemas/me";
import type { UserDetail as UserDetailModel } from "./model";
import { Badge, statusLabel } from "../../../../components/Badge";
import { usePortalHashLocation } from "../../hash-location";
import { Alert } from "../../../../ui/Alert";
import { Avatar, AvatarStanding } from "../../../../ui/Avatar";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import {
  userParticipationResponseSchema,
  type UserGroupParticipation,
  type UserParticipation,
} from "../../../../../shared/schemas/user-participation";
import { Button } from "../../../../ui/Button";
import { IconPencil } from "../../../../components/icons";
import { UserPortrait } from "./UserPortrait";
import { useUserRecordCommands } from "./use-user-record-commands";
import { Menu } from "../../../../ui/Menu";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { userRecordFacts } from "./user-record-facts";
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
  const canRead = permissions.canRead || isSelf;
  const selfProfile = isSelf ? profileSignal.value : null;

  const load = useCallback(async () => {
    if (!canRead) return;
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
  }, [canRead, userId]);

  useEffect(() => {
    void load();
  }, [load]);

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
  }, [canRead, userId]);

  /**
   * Re-reads the signed-in member's own profile after they change it.
   *
   * The record and the account menu draw the same person from two responses;
   * whichever one changed, the other has to be told, or the sidebar keeps
   * showing the portrait that was just replaced.
   */
  async function refreshSelfProfile(): Promise<void> {
    saveProfile(await getJson(CURRENT_USER_API, myProfileSchema));
    await load();
  }

  if (!canRead) {
    return <ErrorAlert error="You need Users read permission to open a user record." />;
  }
  if (loading) return <Spinner label="Loading user…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!user) return null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const [editingProfile, setEditingProfile] = useState(false);
  const editable = permissions.canWrite && !user.pii_redacted_at;
  /*
   * The subject's own hold over their photo. It is not `editable`: a member
   * administers nobody, including themselves, yet their portrait has always
   * been theirs to set — it just used to be set on a page of its own.
   */
  const selfEditable = isSelf && !user.pii_redacted_at;
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
  const recordActions = useUserRecordCommands({
    user,
    editable,
    selfEditable,
    canWrite: permissions.canWrite,
    canAnonymize: permissions.canAnonymize,
    editing: editingProfile,
    onEdit: () => setEditingProfile(true),
    reload: load,
  });

  /*
   * Two lists, two questions. Contact answers "how do I reach this person",
   * which is what the address is for; Account answers "what is this record",
   * which is names, role and dates. The address appeared in both until the
   * Contact card existed, and a fact stated twice on one page is a fact the
   * reader has to check for agreement.
   */
  const { contactEmail, contactFacts, accountFacts } = userRecordFacts(user, identity, {
    // The subject's own card states and edits them instead.
    namesStatedElsewhere: isSelf && Boolean(selfProfile),
  });

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
          /*
            The portrait is the control that changes it, for a reader who may
            (#28). A photograph used to be set only from a file input at the
            foot of the record under "Account administration"; here it is the
            face itself, the way every network the reader already uses does
            it. A reader who may not change it sees the portrait alone.

            Either way it wears the same standing: the role on the ring, and
            `neutral` desaturating it for a deactivated account so the
            standing reads as held-before without a second badge saying so.
          */
          <AvatarStanding status={{ label: statusLabel(user.role), tone: user.active ? "accent" : "neutral" }}>
            {portraitEditable ? (
              <UserPortrait
                userId={user.id}
                displayName={displayName}
                headshotUrl={user.headshotUrl ?? null}
                isSelf={isSelf}
                canEdit
                /* The subject's own portrait is read by the rest of the portal
                   from the stored profile, so their change re-reads that as
                   well as the record; everybody else's is only the record. */
                onChanged={isSelf ? refreshSelfProfile : load}
              />
            ) : (
              <Avatar name={displayName} src={user.headshotUrl ?? undefined} size="xl" />
            )}
          </AvatarStanding>
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
          `Created ${fmt(user.created_at)}`,
          user.pii_redacted_at ? "Anonymized" : null,
        ].filter((fact): fact is string => Boolean(fact))}
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

          <MemberSkillsPanel userId={user.id} canRead={canRead} canVouch={!isSelf} />

          {participationGroups.length > 0 && (
            <div class="pk-table-list">
              <DataTable
                caption="Group participation"
                showCaption
                columns={groupColumns}
                rows={participationGroups}
                rowKey={(row) => row.group.id}
                /*
                 * A row here names another record, so it goes to that record
                 * (#45). An href rather than a handler, because it is a
                 * navigation: it opens in a new tab if the reader asks it to.
                 */
                rowAction={(row) => ({
                  label: `Open ${row.group.name}`,
                  href: usePortalHashLocation.hrefs(`/groups/${encodeURIComponent(row.group.id)}`),
                })}
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

          <UserParticipationHistory userId={user.id} canRead={canRead} />

          {/*
            Who edits this record, and as what. Its subject edits it as
            themselves, through the member contract — nobody administers
            themselves, and a role or a deactivation is somebody else's
            decision to record. Everybody else edits it as staff.

            The name stays with the record rather than behind the disclosure
            below. It is the record's own title: a person whose name came
            across a migration wrong is exactly who somebody opens this page to
            fix, and they should not have to find "account administration".
          */}
          {isSelf && selfProfile ? (
            <SelfProfilePanel
              profile={selfProfile}
              editing={editingProfile}
              onEdit={() => setEditingProfile(true)}
              onClose={() => setEditingProfile(false)}
              onSaved={refreshSelfProfile}
            />
          ) : null}

          {/* Operations on the account rather than statements about the
              person, so they are disclosed under the record instead of
              reading as three more things it says. */}
          {permissions.canRead && (
            <UserAdministrationSection>
              <UserEmailAddressesPanel userId={user.id} primaryEmail={user.email} canWrite={permissions.canWrite} />
            </UserAdministrationSection>
          )}
        </div>

        <aside class="pk-stack">
          <MemberAvailabilityPanel userId={user.id} canRead={canRead} canWrite={editable} contactEmail={contactEmail} />
          <MemberStandingPanel userId={user.id} canRead={canRead} />

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

          {/*
            The record's account fields, read and written in the one place.

            Editing used to open a whole second panel further down the page
            carrying the same fields the card beside it was already stating,
            so a reader changing a name looked at it twice and the two could
            disagree while the draft was open. #46 asked for the fields to be
            edited where they are shown, and this is that: the same card, the
            same fields, in the same order — a list while nobody is editing,
            the fields themselves once somebody is.
          */}
          <Panel aria-label="Account">
            <PanelHeader title="Account">
              {/* The quiet second way in that #46 asked for, beside the facts
                  it edits. The record's actions menu still carries the same
                  command in words; this is the shortcut, not the only door,
                  so it is an icon and it disappears while the fields are
                  open. */}
              {editable && !editingProfile && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon
                  aria-label="Edit profile"
                  title="Edit profile"
                  onClick={() => setEditingProfile(true)}
                >
                  <IconPencil />
                </Button>
              )}
            </PanelHeader>
            <PanelBody>
              {editable && editingProfile ? (
                <UserProfileEditor
                  user={user}
                  canGrantAccess={permissions.canGrantAccess}
                  editing={editingProfile}
                  onClose={() => setEditingProfile(false)}
                  onSaved={load}
                />
              ) : (
                /* One record's fields as a description list rather than an
                   unnamed table, on a page that already has several tables. */
                <DescriptionList density="compact" items={accountFacts} />
              )}
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
