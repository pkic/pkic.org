import {
  contentContributionForRoute,
  contributionForSource,
} from "../../functions/_lib/services/site-content-contributions";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ContentContributionLinks } from "../../assets/ts/site/ContentContributionLinks";
import { selectedContentFeedbackUrl } from "../../assets/ts/site/content-selection-feedback";
import { contentEditUrl, contentFeedbackUrl } from "../../assets/shared/content-contribution";

const context = {
  repository: "pkic/pqcmm",
  contributionBranch: "release/1.1.x",
  sourcePath: "model/pqcmm-model.yaml",
  sourceVersion: "1.1.1",
  sourceRevision: "v1.1.1",
  feedbackTemplate: "model-feedback.yml",
};
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("website contribution handoff", () => {
  it("routes configured content and excludes private portal pages", () => {
    expect(contentContributionForRoute("/wg/pqc/pqcmm/levels/1-initial/")?.repository).toBe("pkic/pqcmm");
    expect(contentContributionForRoute("/wg/pqc/pqcmm/")?.contributionBranch).toBe("main");
    expect(contentContributionForRoute("/wg/pqc/pqcmm/adoption/")?.repository).toBe("pkic/pkic.org");
    expect(contentContributionForRoute("/portal/")).toBeUndefined();
  });
  it("edits the actual authored website file rather than guessing a filename from its public route", () => {
    const authored = contributionForSource("../../../content/about/custom-page.md");
    const page = contentContributionForRoute("/a-custom-public-route/", authored)!;
    expect(contentEditUrl(page)).toBe("https://github.com/pkic/pkic.org/edit/main/content/about/custom-page.md");
  });
  it("routes current and historic PKIMM pages to their owning repository", () => {
    for (const root of ["model", "1.0.0"]) {
      const authored = contributionForSource(`../../../content/wg/pkimm/${root}/categories/cryptography.md`);
      expect(contentEditUrl(authored)).toBe("https://github.com/pkic/pkimm/edit/main/categories/cryptography.md");
    }
    expect(contributionForSource("../../../content/wg/pkimm/extensions/example.md").repository).toBe(
      "pkic/pkimm-extensions",
    );
  });
  it("prefills generic feedback without requiring a model-specific issue form", () => {
    const source = contributionForSource("../../../content/about/_index.md");
    const url = new URL(contentFeedbackUrl(source, "https://pkic.org/about/#scope", "Suggested wording", "scope"));
    expect(url.pathname).toBe("/pkic/pkic.org/issues/new");
    expect(url.searchParams.has("template")).toBe(false);
    expect(url.searchParams.get("body")).toContain("content/about/_index.md");
    expect(url.searchParams.get("body")).toContain("Suggested wording");
    expect(url.searchParams.get("body")).toContain("#scope");
  });
  it("offers feedback without a fictional edit target on generated pages", () => {
    const source = contentContributionForRoute("/search/")!;
    expect(source.sourcePath).toBeUndefined();
    document.body.innerHTML = render(<ContentContributionLinks context={source} page="https://pkic.org/search/" />);
    expect(document.querySelectorAll("a")).toHaveLength(1);
    expect(document.querySelector("a")?.textContent).toContain("Suggest a change");
  });
  it("keeps the older version being read separate from the editable maintenance branch", () => {
    const url = new URL(
      contentFeedbackUrl(context, "https://pkic.org/wg/pqc/pqcmm/1.1.1/", "Quoted & selected text", "1.2.3"),
    );
    expect(url.searchParams.get("source-version")).toBe("1.1.1");
    expect(url.searchParams.get("source-revision")).toBe("v1.1.1");
    expect(url.searchParams.get("selected-text")).toBe("Quoted & selected text");
    expect(url.searchParams.get("item-id")).toBe("1.2.3");
    expect(contentEditUrl(context)).toBe("https://github.com/pkic/pqcmm/edit/release%2F1.1.x/model/pqcmm-model.yaml");
    expect(url.searchParams.has("milestone")).toBe(false);
  });
  it("bounds selected wording and does not invent an absent displayed version", () => {
    const url = new URL(
      contentFeedbackUrl(
        { ...context, sourceVersion: undefined, sourceRevision: undefined },
        "https://pkic.org/",
        "x".repeat(1000),
      ),
    );
    expect(url.searchParams.get("selected-text")).toHaveLength(300);
    expect(url.searchParams.get("source-version")).toBe("Not specified on the page");
    expect(url.searchParams.has("source-revision")).toBe(false);
  });
  it("provides keyboard-accessible feedback and editing links without JavaScript", () => {
    document.body.innerHTML = render(
      <ContentContributionLinks context={context} page="https://pkic.org/wg/pqc/pqcmm/" />,
    );
    expect(document.querySelectorAll("a")).toHaveLength(2);
    expect(document.querySelector("[data-content-feedback-link]")?.textContent).toContain("Suggest a change");
  });
  it("captures a later authored region without confusing it with the first region or site chrome", () => {
    document.body.innerHTML = `${render(<ContentContributionLinks context={context} page="https://pkic.org/about/" />)}<section data-pagefind-body><h2 id="first">First</h2><p>First region</p></section><section data-pagefind-body><h2 id="second">Second</h2><p>Selected second region</p></section>`;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll("section[data-pagefind-body] p")[1]!);
    selection.addRange(range);
    const url = new URL(selectedContentFeedbackUrl(document, selection, "https://pkic.org/about/")!);
    expect(url.searchParams.get("selected-text")).toBe("Selected second region");
    expect(url.searchParams.get("source-page")).toContain("#second");
  });
  it("captures the selected wording and nearest item without including site chrome", () => {
    document.body.innerHTML = `${render(<ContentContributionLinks context={context} page="https://pkic.org/wg/pqc/pqcmm/" />)}<main data-pagefind-body><h3 id="criterion-1-2-3">Criterion 1.2.3</h3><p data-content-item-id="1.2.3">Original wording</p></main><footer>Footer</footer>`;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("main p")!);
    selection.addRange(range);
    const url = new URL(selectedContentFeedbackUrl(document, selection, "https://pkic.org/wg/pqc/pqcmm/")!);
    expect(url.searchParams.get("item-id")).toBe("1.2.3");
    expect(url.searchParams.get("selected-text")).toBe("Original wording");
    expect(url.searchParams.get("source-page")).toContain("#criterion-1-2-3");
    selection.removeAllRanges();
    range.selectNodeContents(document.querySelector("footer")!);
    selection.addRange(range);
    expect(selectedContentFeedbackUrl(document, selection, "https://pkic.org/")).toBeUndefined();
  });
});
