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
          <span class="content-version-notice__detail"> · {draft ? "For review" : "Earlier release"}</span>
        </span>
        <a href={notice.currentHref}>View current release →</a>
      </div>
    </aside>
  );
}
