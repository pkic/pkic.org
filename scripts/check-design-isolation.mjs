/**
 * Keeps the design system isolated from the quarantined legacy stylesheet.
 *
 * Two failures this catches, both of which are silent until someone notices
 * the system has stopped being a system:
 *
 *   1. A component reaching for a Bootstrap class or a `--bs-*` variable.
 *      It works today, breaks when Bootstrap is removed, and means the
 *      component is no longer described by its own stylesheet.
 *   2. A colour, radius, or duration literal in component CSS. One hex in one
 *      component is how a token system quietly stops being the single source.
 *
 * Scope is the design system only — the legacy tree is expected to violate
 * both and is not scanned.
 *
 * Usage: node scripts/check-design-isolation.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();

/**
 * Surfaces that have adopted the design system and must stay free of
 * Bootstrap. This list is the ratchet for the framework removal: a surface
 * joins it once it is clean, and can then never regress. Nothing is ever
 * removed from it.
 *
 * Deliberately NOT a baseline of tolerated violations — a surface is added
 * only after its violations are gone, so the gate always demands zero.
 */
const scanned = [
  "assets/ts/ui",
  "assets/design",
  "layouts/design",
  // Individual files, so a directory can be locked in one surface at a time
  // rather than waiting for every file in it to be migrated at once.
  "layouts/wg/wg-sub.html",
  "layouts/wg/section.html",
  "layouts/shortcodes/joinform.html",
  "layouts/shortcodes/invite-decline.html",
  "layouts/shortcodes/event-proposal.html",
  "layouts/shortcodes/event-proposal-manage.html",
  "layouts/shortcodes/event-sponsor-checkout.html",
  "assets/ts/member-flows/portal/sections/AccountSettings.tsx",
  "assets/ts/components/proposals/ProposalDecisionPanel.tsx",
  // The shared components every surface renders. Migrating their internals
  // converts every consumer at once, so these are held at zero first.
  "assets/ts/components/Badge.tsx",
  "assets/ts/components/Spinner.tsx",
  "assets/ts/components/ErrorAlert.tsx",
  "assets/ts/components/ConfirmDialog.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/EventStats.tsx",
  "assets/ts/member-flows/portal/sections/email-templates/EmailTemplateEditor.tsx",
  "assets/ts/member-flows/portal/sections/MyProfile.tsx",
  "assets/ts/member-flows/portal/sections/MyOrganization.tsx",
  "assets/ts/components/forms/FormFieldConfigEditor.tsx",
  "assets/ts/components/events/EventEmailCampaign.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/AttendanceChangeDashboard.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/settings/GeneralTab.tsx",
  "assets/ts/components/Table.tsx",
  "assets/ts/components/ApiDataTable.tsx",
  "assets/ts/components/Pager.tsx",
  "assets/ts/components/Tabs.tsx",
  "assets/ts/components/EmptyState.tsx",
  "assets/ts/member-flows/portal/shell/PortalNavigationShell.tsx",
  "assets/ts/member-flows/portal/shell/PortalShell.tsx",
  "assets/ts/member-flows/portal/shell/SidebarGroups.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupVoteStatistics.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupVoteCreateForm.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationEditForm.tsx",
  "assets/ts/member-flows/portal/sections/MyApplications.tsx",
  "assets/ts/member-flows/portal/sections/system-operations/ScheduledJobs.tsx",
  "assets/ts/member-flows/portal/sections/system-operations/EmailOutbox.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/ProposalDetailPage.tsx",
  "assets/ts/components/proposals/ProposalSpeakerCard.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/RegistrationDetailPage.tsx",
  "assets/ts/member-flows/portal/sections/management/EventDaysEditor.tsx",
  "assets/ts/member-flows/portal/sections/MembershipConfiguration.tsx",
  "assets/ts/components/forms/FormDefinitionEditor.tsx",
  "assets/ts/member-flows/portal/sections/system-organizations/OrganizationCreateForm.tsx",
  "assets/ts/member-flows/portal/sections/system-organizations/OrganizationProfile.tsx",
  "assets/ts/member-flows/portal/sections/sponsors/management/SponsorshipDetail.tsx",
  "assets/ts/member-flows/portal/sections/Home.tsx",
  "assets/ts/member-flows/portal/sections/GroupParticipationCard.tsx",
  "assets/ts/components/event-invites/BulkInviteComposer.tsx",
  "assets/ts/components/event-registrations/DayAttendanceManager.tsx",
  "assets/ts/member-flows/portal/sections/email-templates/EmailTemplates.tsx",
  "assets/ts/member-flows/portal/sections/management/EventTermsEditor.tsx",
  "assets/ts/member-flows/portal/sections/system-users/UserMembershipCard.tsx",
  "assets/ts/member-flows/portal/sections/system-users/UserMembershipPanel.tsx",
  "assets/ts/member-flows/portal/sections/leadership/LeadershipPositions.tsx",
  "assets/ts/member-flows/portal/sections/leadership/Leadership.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupSettingsForm.tsx",
  "assets/ts/components/FormActions.tsx",
  "assets/ts/components/SuccessPanel.tsx",
  "assets/ts/components/NotFoundPanel.tsx",
  "assets/ts/components/VerifyingOverlay.tsx",
  "assets/ts/components/MagicLinkFeedback.tsx",
  "assets/ts/components/DetailsSummary.tsx",
  "assets/ts/components/PersonCell.tsx",
  "assets/ts/components/StatCard.tsx",
  "assets/ts/components/Markdown.tsx",
  "assets/ts/components/AuditLogTable.tsx",
  "assets/ts/components/ConsentCard.tsx",
  "assets/ts/components/passkey-settings.tsx",
  "assets/ts/components/ProfileLinksInput.tsx",
  "assets/ts/components/ServerSearchSelect.tsx",
  "assets/ts/components/UserPicker.tsx",
  "assets/ts/components/EnumSelect.tsx",
  "assets/ts/components/FilterSelect.tsx",
  "layouts/partials/navbar.html",
  "assets/js/session-registration.js",
  "assets/js",
  "assets/ts/member-flows/portal/sections/management/GroupStatistics.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupCreateForm.tsx",
  "assets/ts/member-flows/portal/sections/system-organizations/IdentityRoster.tsx",
  "assets/ts/member-flows/portal/sections/system-users/UserProfileEditor.tsx",
  "assets/ts/member-flows/portal/sections/system-donations/DonationAnalytics.tsx",
  "assets/ts/member-flows/portal/sections/system-donations/Donations.tsx",
  "assets/ts/components/proposals/ProposalReviewsPanel.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingGuests.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/proposal-detail/PresentationVersionsTab.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/proposal-detail/ProposalSidebar.tsx",
  "assets/ts/member-flows/portal/sections/access-control/roles/RoleDetail.tsx",
  "assets/ts/member-flows/portal/sections/access-control/Grants.tsx",
  "assets/ts/member-flows/portal/sections/Participation.tsx",
  "assets/ts/components/forms/management/FormManagement.tsx",
  "assets/ts/member-flows/portal/sections/sponsors/management/CreateSponsorshipForm.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationAnswersCard.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingSeriesFields.tsx",
  "assets/ts/member-flows/portal/shell/McpAuthorization.tsx",
  "assets/ts/member-flows/portal/shell/Login.tsx",
  "layouts/partials/hero.html",
  "layouts/index.html",
  "assets/ts/member-flows/portal/sections/management/GroupLeadership.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupLeadershipAssignmentForm.tsx",
  "layouts/shortcodes/agenda.html",
  "layouts/shortcodes/event-speaker-presentation.html",
  "assets/ts/member-flows/portal/sections/system-analytics/AnalyticsOverview.tsx",
  "assets/ts/member-flows/portal/sections/system-analytics/RegistrationAnalytics.tsx",
  "assets/ts/member-flows/portal/sections/system-analytics/Tables.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationCommunicationsCard.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationOverviewCard.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationDetailView.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupMailingListManager.tsx",
  "assets/ts/components/mailing-lists/MailingListForm.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupEventEditor.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupEventWorkspace.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupVoteManagementControls.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupVoteProposals.tsx",
  "assets/ts/member-flows/portal/sections/OrganizationContentReviews.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/registration-detail/RegistrationPanels.tsx",
  "assets/ts/components/SpeakerFormCard.tsx",
  "assets/ts/components/proposals/ProposalSpeakersPanel.tsx",
  "assets/ts/components/proposals/ProposalInternalCommentsPanel.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupOverview.tsx",
  "assets/ts/member-flows/portal/sections/access-control/roles/RoleCreate.tsx",
  "assets/ts/member-flows/portal/sections/access-control/UserRoles.tsx",
  "assets/ts/shared/widgets/share-panel.tsx",
  "assets/ts/shared/donation/widget.tsx",
  "assets/ts/shared/donation/form.tsx",
  "layouts/partials/footer.html",
  "assets/ts/member-flows/vote-detail-page.tsx",
  "assets/ts/member-flows/portal/sections/Votes/VoteDetails.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingOccurrenceFields.tsx",
  "assets/ts/member-flows/portal/sections/management/ResourceSharingEditor.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/Team.tsx",
  "assets/ts/member-flows/portal/sections/sponsors/Attendees.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupWorkspace.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupEventRegistrationPanel.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupFormPlacementEditor.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationTransitionCard.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupMembers.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupMemberAddForm.tsx",
  "assets/ts/event-flows/registration-confirm-page.tsx",
  "assets/ts/shared/donation/thank-you.tsx",
  "assets/ts/member-flows/portal/sections/system-users/UserDetail.tsx",
  "assets/ts/member-flows/member-detail-page.tsx",
  "layouts/shortcodes/event-registration-confirm.html",
  "layouts/events/list.html",
  "layouts/shortcodes/sponsorform.html",
  "layouts/shortcodes/event-registration.html",
  "layouts/partials/donations/form-widget.html",
  "assets/ts/shared/form/button-loading.tsx",
  "assets/ts/shared/form/success-panel.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupVoteLifecycleActions.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingSeriesSettings.tsx",
  "assets/ts/member-flows/portal/sections/access-control/roles/RoleEditForm.tsx",
  "assets/ts/components/RecurrenceEditor.tsx",
  "assets/ts/member-flows/portal/sections/sponsors/management/SponsorshipTierConfig.tsx",
  "layouts/partials/wg-sub-navigation.html",
  "assets/ts/member-flows/portal/sections/access-control/roles/RoleAssignForm.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/settings/SponsorTiersTab.tsx",
  "assets/ts/member-flows/portal/sections/management/EventFormPlacementEditor.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupMembersRoster.tsx",
  "assets/ts/member-flows/sponsors-wall.tsx",
  "assets/ts/components/EventScheduleFields.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingOccurrences.tsx",
  "assets/ts/member-flows/portal/sections/sponsors/management/CompanyDetailPanel.tsx",
  "assets/ts/member-flows/portal/sections/management/EventRegistrationSettingsEditor.tsx",
  "assets/ts/components/MembershipCategoryPicker.tsx",
  "layouts/shortcodes/news.html",
  "assets/ts/event-flows/speaker-manage-page.tsx",
  "assets/ts/components/forms/FormSubmissionForm.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingOccurrenceEditor.tsx",
  "assets/ts/member-flows/portal/sections/membership-applications/ApplicationDocumentsCard.tsx",
  "assets/ts/member-flows/portal/sections/sponsors/index.tsx",
  "assets/ts/member-flows/portal/sections/access-control/TargetPicker.tsx",
  "assets/ts/shared/widgets/link-recovery.tsx",
  "layouts/shortcodes/livestream.html",
  "assets/ts/member-flows/portal/sections/management/ResourceCapabilities.tsx",
  "assets/ts/member-flows/portal/sections/system-operations/Operations.tsx",
  "layouts/partials/social.html",
  "layouts/shortcodes/carousel.html",
  "assets/ts/member-flows/portal/sections/SystemManagement.tsx",
  "assets/ts/member-flows/portal/sections/system-organizations/OrganizationLogo.tsx",
  "layouts/partials/menu.html",
  "layouts/shortcodes/members.html",
  "assets/ts/components/icons/index.tsx",
  "assets/ts/member-flows/portal/sections/events/detail/proposal-detail/AuditLogSection.tsx",
  "assets/ts/member-flows/portal/sections/management/GroupEventCommunications.tsx",
  "assets/ts/member-flows/portal/sections/events/EventWorkspace.tsx",
  "layouts/shortcodes/glossary.html",
  "assets/ts/member-flows/portal/sections/management/GroupMeetingSeriesDetail.tsx",
  "layouts/partials/events/webinar-disclaimer.html",
  "layouts/partials/events/conference-schema.html",
  "layouts/partials/wg/spotlight-card.html",
  "assets/ts/components/proposals/ProposalCoSpeakerInviteForm.tsx",
  "assets/ts/member-flows/portal/sections/Votes/BallotForm.tsx",
  "assets/ts/member-flows/meeting-join/App.tsx",
  "assets/ts/components/TimeZoneSelect.tsx",
  "assets/ts/member-flows/portal/sections/events/EventList.tsx",
  "assets/ts/components/LogoManager.tsx",
  "assets/ts/member-flows/portal/sections/system-analytics/SystemAnalytics.tsx",
  "assets/ts/member-flows/portal/sections/Placeholder.tsx",
  "assets/ts/member-flows/portal/sections/management/MeetingOccurrenceDetail.tsx",
  "assets/ts/member-flows/portal/sections/system-users/Users.tsx",
  "assets/ts/components/forms/form-answers.ts",
];

/** An entry is either a directory prefix or an exact file path. */
function isAdopted(rel) {
  return scanned.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
}

/** Everything still on Bootstrap, measured by `--report` so the remaining
 *  distance is visible without pretending it is acceptable. */
const remaining = ["assets/ts", "assets/js", "assets/scss", "layouts"];

/**
 * Bootstrap utilities and components, matched as WHOLE class tokens.
 *
 * Whole-token matching matters: a substring test flags our own `pk-table` for
 * containing "table", and a gate that cries wolf gets switched off.
 */
const BOOTSTRAP_CLASS =
  /^(btn|btn-[a-z0-9-]+|card|card-[a-z-]+|row|col(-[a-z0-9]+)*|d-[a-z]+(-[a-z]+)*|flex-[a-z-]+|order-[a-z0-9-]+|form-[a-z-]+|input-group[a-z-]*|alert|alert-[a-z-]+|badge|table|table-[a-z-]+|nav|navbar|navbar-[a-z-]+|nav-[a-z-]+|modal|modal-[a-z-]+|offcanvas[a-z-]*|dropdown|dropdown-[a-z-]+|accordion[a-z-]*|carousel[a-z-]*|toast[a-z-]*|tooltip|popover|progress|progress-bar|list-group[a-z-]*|breadcrumb[a-z-]*|pagination|page-[a-z]+|spinner-[a-z-]+|placeholder|ratio|ratio-[a-z0-9x]+|visually-hidden(-focusable)?|stretched-link|text-(muted|center|start|end|nowrap|truncate|uppercase|lowercase|capitalize|decoration-[a-z]+|break|wrap)|text-bg-[a-z]+|link-[a-z]+|bg-[a-z-]+|fw-[a-z]+|fst-[a-z]+|fs-[0-6]|lh-[a-z0-9]+|[mp][xytbse]?-(auto|[0-5])|[mp][xytbse]?-(sm|md|lg|xl|xxl)-(auto|[0-5])|g[xy]?-[0-5]|gap-[0-5]|w-(25|50|75|100|auto)|h-(25|50|75|100|auto)|m[wh]-100|justify-content-[a-z-]+|align-(items|self|content)-[a-z-]+|border|border-[a-z0-9-]+|rounded|rounded-[a-z0-9-]+|shadow|shadow-[a-z]+|position-[a-z]+|top-[0-9]+|start-[0-9]+|end-[0-9]+|bottom-[0-9]+|float-[a-z]+|overflow-[a-z]+|user-select-[a-z]+|small|lead|display-[1-6]|container|container-[a-z]+|sticky-[a-z]+|fixed-[a-z]+|invalid-feedback|valid-feedback|is-(in)?valid|was-validated|clearfix|vstack|hstack)$/;

/** Our own classes are never a violation, whatever word they contain. */
function isBootstrapClassList(value) {
  return value
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.startsWith("pk-"))
    .some((token) => BOOTSTRAP_CLASS.test(token));
}

/** A colour literal in any of the forms a stylesheet accepts. */
const COLOUR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\blab\()/;

/**
 * Every `pk-` class the stylesheets actually define. A component referencing a
 * class nobody wrote renders unstyled and nothing complains — the markup is
 * valid, the build passes, and the surface is just quietly wrong. This has
 * already happened once, with an invented `pk-field--checkbox`.
 */
function definedClasses() {
  const names = new Set();
  const collect = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        collect(full);
        continue;
      }
      if (!entry.endsWith(".css")) continue;
      for (const match of readFileSync(full, "utf8").matchAll(/\.(pk-[a-z0-9_-]+)/g)) {
        names.add(match[1]);
      }
    }
  };
  // Every stylesheet under assets/ts, not only the primitives'. A component
  // keeps its CSS beside itself wherever it lives — `shared/form` has one —
  // and scanning only `ui` reported those classes as undefined.
  for (const dir of ["assets/ts", "assets/design"]) {
    try {
      collect(resolve(root, dir));
    } catch {
      // Nothing to collect.
    }
  }
  return names;
}

const known = definedClasses();
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (/\.(css|tsx?)$/.test(entry)) inspect(full);
  }
}

function report(file, lineNumber, line, reason) {
  failures.push(`${relative(root, file)}:${lineNumber}  ${reason}\n    ${line.trim()}`);
}

function inspect(file) {
  const rel = relative(root, file);
  // The generated stylesheet is the one place literals are correct: it is the
  // rendered output of the token module, which is where they are defined.
  const isGeneratedTokens = rel === "assets/design/tokens.generated.css";
  const isTokenSource = rel.startsWith("assets/design/") && /\.ts$/.test(rel);

  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const lineNumber = index + 1;
      const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");

      if (code.includes("--bs-")) {
        report(file, lineNumber, line, "references a Bootstrap custom property");
      }

      // Every class list on the line, not just the first. A module that builds
      // markup as a string — the chart renderers do — puts several on one line,
      // and checking only the first one silently passed the rest.
      for (const match of code.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
        const classList = match[1];
        if (isBootstrapClassList(classList)) {
          report(file, lineNumber, line, "uses a Bootstrap class name");
        }

        // A `pk-` class nobody defined renders unstyled and passes every other
        // check, so the reference itself is the failure.
        for (const token of classList.split(/\s+/)) {
          if (!token.startsWith("pk-") || known.has(token)) continue;
          report(file, lineNumber, line, `references "${token}", which no stylesheet defines`);
        }
      }

      /*
       * Classes assigned at runtime, which no `class=` attribute check sees.
       *
       * A module that writes `element.className = "small mt-2 text-danger"` or
       * calls `classList.add("btn-primary")` puts Bootstrap back into markup
       * the gate has just certified as clean, after the page has rendered.
       * This is not hypothetical: the donation form was repainting a migrated
       * status line and re-emitting Bootstrap preset buttons on every currency
       * change, into a surface that read zero.
       */
      for (const match of code.matchAll(
        /(?:className\s*=\s*|classList\.(?:add|remove|toggle|replace)\()\s*[`"']([^`"']*)[`"']/g,
      )) {
        if (isBootstrapClassList(match[1])) {
          report(file, lineNumber, line, "assigns a Bootstrap class at runtime");
        }
      }

      // The repository forbids style attributes (assets/AGENTS.md). A dynamic
      // value belongs in a modifier class or a custom property in a stylesheet.
      if (/\sstyle\s*=\s*[{"']/.test(code)) {
        report(file, lineNumber, line, "uses an inline style attribute");
      }

      if (file.endsWith(".css") && !isGeneratedTokens && COLOUR_LITERAL.test(code)) {
        report(file, lineNumber, line, "hard-codes a colour instead of reading a token");
      }

      // Only the values that must stay systematic are policed. A gap or an
      // icon's width is legitimately local; a type size, a corner radius, or a
      // duration is not, because those are what make separate components look
      // like one system.
      if (!isTokenSource && !isGeneratedTokens && file.endsWith(".css")) {
        const declaration = code.match(/^\s*(?!--)([a-z-]+)\s*:\s*([^;]+);/);
        if (declaration) {
          const [, property, value] = declaration;
          const usesToken = value.includes("var(");

          // rem/px are absolute; em and % scale with their context and are a
          // legitimate way for an icon to track the text it sits beside.
          if (property === "font-size" && !usesToken && /\b\d+(\.\d+)?(rem|px)\b/.test(value)) {
            report(file, lineNumber, line, "hard-codes a type size instead of reading a token");
          }

          if (/^border(-[a-z]+)?-radius$/.test(property) && !usesToken && /\b\d+(\.\d+)?(rem|px)\b/.test(value)) {
            report(file, lineNumber, line, "hard-codes a corner radius instead of reading a token");
          }

          if (/^(transition|animation)(-duration)?$/.test(property) && !usesToken && /\b\d+(\.\d+)?m?s\b/.test(value)) {
            report(file, lineNumber, line, "hard-codes a duration instead of reading a token");
          }
        }
      }
    });
}

for (const entry of scanned) {
  const full = resolve(root, entry);
  try {
    if (statSync(full).isDirectory()) walk(full);
    else inspect(full);
  } catch {
    // An entry that does not exist yet is not a failure.
  }
}

function countIn(text) {
  let hits = 0;
  for (const match of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
    hits += match[1]
      .split(/\s+/)
      .filter((token) => token.length > 0 && !token.startsWith("pk-"))
      .filter((token) => BOOTSTRAP_CLASS.test(token)).length;
  }
  return hits + (text.match(/--bs-/g) ?? []).length;
}

/**
 * `--by-file` ranks what is left, so a migration can be planned against the
 * actual distribution rather than a guess. The work is very unevenly spread:
 * a handful of files carry most of it.
 */
if (process.argv.includes("--by-file")) {
  const rows = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!/\.(css|scss|tsx?|js|html)$/.test(entry)) continue;
      const rel = relative(root, full);
      if (isAdopted(rel)) continue;
      const hits = countIn(readFileSync(full, "utf8"));
      if (hits > 0) rows.push({ rel, hits });
    }
  };
  for (const dir of remaining) {
    try {
      visit(resolve(root, dir));
    } catch {
      // Absent directories contribute nothing.
    }
  }
  rows.sort((left, right) => right.hits - left.hits);

  const total = rows.reduce((sum, row) => sum + row.hits, 0);
  const shown = rows.slice(0, 25);
  const covered = shown.reduce((sum, row) => sum + row.hits, 0);

  console.log(`[design-isolation] ${String(rows.length)} files still reference Bootstrap (${String(total)} refs).`);
  console.log(`The 25 heaviest carry ${String(covered)} of them (${String(Math.round((covered / total) * 100))}%):\n`);
  for (const row of shown) {
    console.log(`  ${String(row.hits).padStart(5)}  ${row.rel}`);
  }
  process.exit(0);
}

if (process.argv.includes("--report")) {
  const counts = remaining
    .map((dir) => {
      let hits = 0;
      const visit = (current) => {
        for (const entry of readdirSync(current)) {
          const full = join(current, entry);
          if (statSync(full).isDirectory()) {
            visit(full);
            continue;
          }
          if (!/\.(css|scss|tsx?|js|html)$/.test(entry)) continue;
          if (isAdopted(relative(root, full))) continue;
          const text = readFileSync(full, "utf8");
          for (const match of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
            hits += match[1]
              .split(/\s+/)
              .filter((token) => token.length > 0 && !token.startsWith("pk-"))
              .filter((token) => BOOTSTRAP_CLASS.test(token)).length;
          }
          hits += (text.match(/--bs-/g) ?? []).length;
        }
      };
      try {
        visit(resolve(root, dir));
      } catch {
        // Absent directories contribute nothing.
      }
      return { dir, hits };
    })
    .sort((left, right) => right.hits - left.hits);

  const total = counts.reduce((sum, entry) => sum + entry.hits, 0);
  console.log("[design-isolation] Bootstrap footprint still to remove (phase 5):");
  for (const { dir, hits } of counts) {
    console.log(`  ${String(hits).padStart(6)}  ${dir}`);
  }
  console.log(`  ${String(total).padStart(6)}  total`);
  console.log(`\n  Adopted and held at zero: ${scanned.join(", ")}`);
}

if (failures.length > 0) {
  console.error(`[design-isolation] ${failures.length} violation(s):\n\n${failures.join("\n\n")}\n`);
  console.error("Design-system files read tokens only. See assets/design/AGENTS.md.");
  process.exit(1);
}

// The list is over a hundred entries now, so print the count and let
// `--report` say what is left rather than reciting what is done.
console.log(
  `[design-isolation] ${String(scanned.length)} adopted surfaces contain no Bootstrap references or hard-coded values`,
);
