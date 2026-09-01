import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { asBool, asString, asStringArray, externalLink } from "./helpers";
// `pk-datalist` and `pk-answer-list` are written here as class names rather
// than reached through a component, so this module has to pull their
// stylesheet into its own chunk. Without the import the markup renders
// unstyled and nothing complains.
import "../../../../ui/Content.css";

/**
 * An answer the applicant left blank.
 *
 * The dash alone signals "nothing here" by looking faint, which a screen
 * reader cannot hear and a reader who cannot separate the greys cannot see.
 * The word carries the meaning; the dash is decoration beside it.
 */
function NotProvided() {
  return (
    <>
      <span class="pk-muted" aria-hidden="true">
        —
      </span>
      <span class="pk-sr-only">Not provided</span>
    </>
  );
}

/**
 * One application's answers.
 *
 * A description list, not a table. These are label-and-value once each, which
 * is what a `dl` is for; as a two-column `<table>` with no caption it was
 * announced as an unnamed grid sitting among the other cards on the page.
 * The `dt`/`dd` pairs are direct children of the `<dl>` because `pk-datalist`
 * is a grid over `dl > dt` and `dl > dd` — a wrapper between them takes both
 * out of the grid.
 */
export function ApplicationAnswersCard({ detail }: { detail: MembershipApplicationDetail }) {
  const linkedin = asString(detail.answers.linkedin);
  const website = asString(detail.answers.organization_website);
  const agreements = asStringArray(detail.answers.legalAgreements);

  return (
    <div class="pk">
      <Panel aria-label="Application answers">
        <PanelHeader title="Application answers" />
        <PanelBody>
          <dl class="pk-datalist pk-small">
            <dt>Role / Job title</dt>
            <dd>{asString(detail.answers.job_title) || <NotProvided />}</dd>

            <dt>LinkedIn</dt>
            <dd>{linkedin ? externalLink(linkedin) : <NotProvided />}</dd>

            <dt>Organization website</dt>
            <dd>{website ? externalLink(website) : <NotProvided />}</dd>

            <dt>About yourself</dt>
            <dd>{asString(detail.answers.about_yourself) || <NotProvided />}</dd>

            <dt>About organization</dt>
            <dd>{asString(detail.answers.about_organization) || <NotProvided />}</dd>

            <dt>Reason for joining</dt>
            <dd>{asString(detail.answers.reason) || <NotProvided />}</dd>

            <dt>Contribution type</dt>
            <dd>{asString(detail.answers.contributionType) || <NotProvided />}</dd>

            <dt>Wants to present</dt>
            <dd>{asBool(detail.answers.wantsToPresent) ? "Yes" : "No"}</dd>

            <dt>Interested in sponsoring</dt>
            <dd>{asBool(detail.answers.interestedInSponsoring) ? "Yes" : "No"}</dd>

            <dt>Working groups requested</dt>
            <dd>
              {detail.requestedWorkingGroups.length > 0 ? (
                <ul class="pk-answer-list">
                  {detail.requestedWorkingGroups.map((group) => (
                    <li key={group.slug}>{group.name}</li>
                  ))}
                </ul>
              ) : (
                <NotProvided />
              )}
            </dd>

            <dt>Legal agreements</dt>
            <dd>{agreements.length > 0 ? agreements.join(", ") : <NotProvided />}</dd>

            <dt>Warranted authority</dt>
            <dd>{asBool(detail.answers.warrantedAuthority) ? "Yes" : "No"}</dd>
          </dl>
        </PanelBody>
      </Panel>
    </div>
  );
}
