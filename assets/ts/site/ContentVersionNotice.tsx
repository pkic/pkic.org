import { ExternalLink } from "../ui/ExternalLink";
import type { ContentVersionNoticeData } from "../../shared/content-versions";
import "./ContentVersionNotice.css";

/** Persistent context for any versioned content, including both maturity models. */
export function ContentVersionNotice({ notice }: { notice: ContentVersionNoticeData }) {
  const draft = notice.status === "draft";
  return (
    <aside class="content-version-notice" role="status" aria-label="Content version">
      <div class="pk-container content-version-notice__row">
        <span>
          <strong>
            {draft ? "Draft" : "Version"} {notice.version}
          </strong>
          {draft && notice.revision ? (
            <span class="content-version-notice__revision">
              {" "}
              ·{" "}
              <ExternalLink href={notice.revision.href} aria-label={`View source revision ${notice.revision.label}`}>
                {notice.revision.label}
              </ExternalLink>
            </span>
          ) : null}
          <span class="content-version-notice__detail"> · {draft ? "For review" : "Earlier release"}</span>
        </span>
        <a href={notice.currentHref}>View current release →</a>
      </div>
    </aside>
  );
}
