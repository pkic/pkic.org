import { ContentVersionNotice } from "../../site/ContentVersionNotice";

export function ContentVersionNoticePreview() {
  return (
    <div class="pk-stack">
      <ContentVersionNotice
        notice={{
          version: "1.1.0",
          status: "draft",
          currentHref: "/wg/pqc/pqcmm/levels/",
          revision: {
            label: "d003771",
            href: "https://github.com/pkic/pqcmm/commit/d0037717273772460424cf338192ddd1dac01d80",
          },
        }}
      />
      <ContentVersionNotice notice={{ version: "1.0.0", status: "released", currentHref: "/wg/pkimm/model/" }} />
    </div>
  );
}
