import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { asBool, asString, asStringArray, externalLink } from "./helpers";

export function ApplicationAnswersCard({ detail }: { detail: MembershipApplicationDetail }) {
  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Application answers</div>
      <div class="card-body">
        <table class="table table-sm table-borderless mb-0">
          <tbody>
            <tr>
              <th class="text-muted small">Role / Job title</th>
              <td>{asString(detail.answers.job_title) || <span class="text-muted">—</span>}</td>
            </tr>
            <tr>
              <th class="text-muted small">LinkedIn</th>
              <td>
                {asString(detail.answers.linkedin) ? (
                  externalLink(asString(detail.answers.linkedin))
                ) : (
                  <span class="text-muted">—</span>
                )}
              </td>
            </tr>
            <tr>
              <th class="text-muted small">Organization website</th>
              <td>
                {asString(detail.answers.organization_website) ? (
                  externalLink(asString(detail.answers.organization_website))
                ) : (
                  <span class="text-muted">—</span>
                )}
              </td>
            </tr>
            <tr>
              <th class="text-muted small">About yourself</th>
              <td class="small">{asString(detail.answers.about_yourself) || <span class="text-muted">—</span>}</td>
            </tr>
            <tr>
              <th class="text-muted small">About organization</th>
              <td class="small">{asString(detail.answers.about_organization) || <span class="text-muted">—</span>}</td>
            </tr>
            <tr>
              <th class="text-muted small">Reason for joining</th>
              <td class="small">{asString(detail.answers.reason) || <span class="text-muted">—</span>}</td>
            </tr>
            <tr>
              <th class="text-muted small">Contribution type</th>
              <td>{asString(detail.answers.contributionType) || <span class="text-muted">—</span>}</td>
            </tr>
            <tr>
              <th class="text-muted small">Wants to present</th>
              <td>{asBool(detail.answers.wantsToPresent) ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <th class="text-muted small">Interested in sponsoring</th>
              <td>{asBool(detail.answers.interestedInSponsoring) ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <th class="text-muted small">Working groups requested</th>
              <td>
                {detail.requestedWorkingGroups.length > 0 ? (
                  <ul class="list-unstyled mb-0 small">
                    {detail.requestedWorkingGroups.map((group) => (
                      <li key={group.slug}>{group.name}</li>
                    ))}
                  </ul>
                ) : (
                  <span class="text-muted">—</span>
                )}
              </td>
            </tr>
            <tr>
              <th class="text-muted small">Legal agreements</th>
              <td>
                {asStringArray(detail.answers.legalAgreements).length > 0 ? (
                  asStringArray(detail.answers.legalAgreements).join(", ")
                ) : (
                  <span class="text-muted">—</span>
                )}
              </td>
            </tr>
            <tr>
              <th class="text-muted small">Warranted authority</th>
              <td>{asBool(detail.answers.warrantedAuthority) ? "Yes" : "No"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
