import { formatFormAnswerValue } from "../../../../components/forms/form-answers";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { LinkList } from "../../../../ui/LinkList";
import { asBool, asString, asStringArray, externalLink, toHttpUrl } from "./helpers";
// `pk-datalist` and `pk-answer-list` are written here as class names rather
// than reached through a component, so this module has to pull their
// stylesheet into its own chunk. Without the import the markup renders
// unstyled and nothing complains.
import "../../../../ui/Content.css";
import { Markdown } from "../../../../components/Markdown";

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
export function ApplicationAnswersCard({
  detail,
}: {
  detail: Pick<MembershipApplicationDetail, "answers" | "requestedWorkingGroups" | "answerFields">;
}) {
  const linkedin = asString(detail.answers.linkedin);
  const website = asString(detail.answers.organization_website);
  const policyAnswers = [
    ["agrees_bylaws", "Bylaws"],
    ["agrees_code_of_conduct", "Code of Conduct"],
    ["agrees_ipr_policy", "IPR Policy"],
  ] as const;
  const agreements = policyAnswers.some(([key]) => key in detail.answers)
    ? policyAnswers.filter(([key]) => asBool(detail.answers[key])).map(([, label]) => label)
    : asStringArray(detail.answers.legalAgreements);

  return (
    <div class="pk">
      <Panel aria-label="Application answers">
        <PanelHeader title="Application answers" />
        <PanelBody>
          <dl class="pk-datalist pk-small">
            <dt>Role / Job title</dt>
            <dd>{asString(detail.answers.job_title) || <NotProvided />}</dd>

            {/* The form calls this "Professional profile (e.g., LinkedIn)"
                and accepts an employer's leadership page just as happily; the
                card said "LinkedIn" and printed the raw address. Named after
                what it is, and shown as the site it points at. */}
            <dt>Professional profile</dt>
            <dd>{linkedin ? <LinkList links={[toHttpUrl(linkedin)]} /> : <NotProvided />}</dd>

            <dt>Organization website</dt>
            <dd>{website ? externalLink(website) : <NotProvided />}</dd>

            <dt>About yourself</dt>
            <dd>
              {asString(detail.answers.about_yourself) ? (
                <Markdown markdown={asString(detail.answers.about_yourself)} />
              ) : (
                <NotProvided />
              )}
            </dd>

            <dt>About organization</dt>
            <dd>
              {asString(detail.answers.about_organization) ? (
                <Markdown markdown={asString(detail.answers.about_organization)} />
              ) : (
                <NotProvided />
              )}
            </dd>

            <dt>Reason for joining</dt>
            <dd>
              {asString(detail.answers.reason) ? (
                <Markdown markdown={asString(detail.answers.reason)} />
              ) : (
                <NotProvided />
              )}
            </dd>

            <dt>Contribution type</dt>
            <dd>
              {asString(detail.answers.contribution_type ?? detail.answers.contributionType) ? (
                formatFormAnswerValue(
                  detail.answers.contribution_type ?? detail.answers.contributionType,
                  detail.answerFields?.find((field) => field.key === "contribution_type"),
                ).join(", ")
              ) : (
                <NotProvided />
              )}
            </dd>

            <dt>Wants to present</dt>
            <dd>{asBool(detail.answers.wants_to_present ?? detail.answers.wantsToPresent) ? "Yes" : "No"}</dd>

            <dt>Interested in sponsoring</dt>
            <dd>
              {asBool(detail.answers.interested_in_sponsoring ?? detail.answers.interestedInSponsoring) ? "Yes" : "No"}
            </dd>

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
            {/* The join form posts the box as `warranted_authority`; older
                answers carried the camel-cased key (#109). */}
            <dd>{asBool(detail.answers.warranted_authority ?? detail.answers.warrantedAuthority) ? "Yes" : "No"}</dd>
          </dl>
        </PanelBody>
      </Panel>
    </div>
  );
}
