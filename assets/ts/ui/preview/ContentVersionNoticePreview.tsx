import { ContentVersionNotice } from "../../site/ContentVersionNotice";

export function ContentVersionNoticePreview() {
  return (
    <div class="pk-stack">
      <ContentVersionNotice notice={{ version: "1.1.0", status: "draft", currentHref: "/wg/pqc/pqcmm/levels/" }} />
      <ContentVersionNotice notice={{ version: "1.0.0", status: "released", currentHref: "/wg/pkimm/model/" }} />
    </div>
  );
}
