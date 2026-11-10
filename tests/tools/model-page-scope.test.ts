import { describe, expect, it } from "vitest";
import { scopeModelHtml } from "../../site/model-version-navigation";

describe("model page link scoping", () => {
  const modelRoot = "/wg/pqc/pqcmm/";
  const draftRoot = "/wg/pqc/pqcmm/drafts/1.1.0/";

  it("keeps model links on the draft a reader is viewing", () => {
    const html = scopeModelHtml(
      '<p>See <a href="/wg/pqc/pqcmm/levels/1-initial/">Level 1</a>.</p>',
      modelRoot,
      draftRoot,
    );
    expect(html).toContain(`href="${draftRoot}levels/1-initial/"`);
  });

  it("leaves anchors and links outside the model alone", () => {
    const html = scopeModelHtml('<a href="#1.2.1">1.2.1</a> <a href="/wg/pqc/">PQC</a>', modelRoot, draftRoot);
    expect(html).toContain('href="#1.2.1"');
    expect(html).toContain('href="/wg/pqc/"');
  });
});
