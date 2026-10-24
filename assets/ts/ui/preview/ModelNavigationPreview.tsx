import { WorkingGroupSidebarTree } from "../../site/WorkingGroupSidebar";
import "../../components/working-group-pages.css";
import "../../site/WorkingGroupSection.css";

export function ModelNavigationPreview() {
  return (
    <nav class="wg-sidebar wg-pqc" aria-label="Model navigation">
      <WorkingGroupSidebarTree
        tree={{
          root: { label: "PQC maturity model (PQCMM)", href: "/wg/pqc/pqcmm/", current: true },
          sections: [
            { label: "Maturity levels", href: "/wg/pqc/pqcmm/levels/", current: false },
            { label: "Version History", href: "/wg/pqc/pqcmm/version-history/", current: false },
          ],
          versions: {
            label: "Switch model version",
            items: [
              {
                id: "release",
                version: "1.0.1",
                status: "released",
                label: "1.0.1",
                href: "/wg/pqc/pqcmm/",
                current: true,
                latest: true,
                fallback: false,
              },
              {
                id: "draft",
                version: "1.1.0",
                status: "draft",
                label: "1.1.0 — Draft",
                href: "/wg/pqc/pqcmm/drafts/1.1.0/",
                current: false,
                latest: false,
                fallback: false,
              },
            ],
          },
        }}
      />
    </nav>
  );
}
