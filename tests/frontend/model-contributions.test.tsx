import { modelContributionForRoute } from "../../site/model-contribution";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ModelContributionLinks } from "../../assets/ts/site/ModelContributionLinks";
import { selectedModelFeedbackUrl } from "../../assets/ts/site/model-selection-feedback";
import { modelEditUrl, modelFeedbackUrl } from "../../assets/shared/model-contribution";

const context = {
  repository: "pkic/pqcmm",
  contributionBranch: "release/1.1.x",
  sourcePath: "model/pqcmm-model.yaml",
  sourceVersion: "1.1.1",
  sourceRevision: "v1.1.1",
};
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("model contribution handoff", () => {
  it("only enables model feedback on explicitly registered model pages", () => {
    expect(modelContributionForRoute("/wg/pqc/pqcmm/levels/1-initial/")?.repository).toBe("pkic/pqcmm");
    expect(modelContributionForRoute("/wg/pqc/pqcmm/")?.contributionBranch).toBe("main");
    expect(modelContributionForRoute("/wg/pqc/pqcmm/adoption/")).toBeUndefined();
    expect(modelContributionForRoute("/portal/")).toBeUndefined();
  });
  it("keeps the older version being read separate from the editable maintenance branch", () => {
    const url = new URL(
      modelFeedbackUrl(context, "https://pkic.org/wg/pqc/pqcmm/1.1.1/", "Quoted & selected text", "1.2.3"),
    );
    expect(url.searchParams.get("source-version")).toBe("1.1.1");
    expect(url.searchParams.get("source-revision")).toBe("v1.1.1");
    expect(url.searchParams.get("selected-text")).toBe("Quoted & selected text");
    expect(url.searchParams.get("item-id")).toBe("1.2.3");
    expect(modelEditUrl(context)).toBe("https://github.com/pkic/pqcmm/edit/release%2F1.1.x/model/pqcmm-model.yaml");
    expect(url.searchParams.has("milestone")).toBe(false);
  });
  it("bounds selected wording and does not invent an absent displayed version", () => {
    const url = new URL(
      modelFeedbackUrl(
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
      <ModelContributionLinks context={context} page="https://pkic.org/wg/pqc/pqcmm/" />,
    );
    expect(document.querySelectorAll("a")).toHaveLength(2);
    expect(document.querySelector("[data-model-feedback-link]")?.textContent).toContain("Suggest a change");
  });
  it("captures the selected wording and nearest item without including site chrome", () => {
    document.body.innerHTML = `${render(<ModelContributionLinks context={context} page="https://pkic.org/wg/pqc/pqcmm/" />)}<main data-pagefind-body><h3 id="criterion-1-2-3">Criterion 1.2.3</h3><p data-model-item-id="1.2.3">Original wording</p></main><footer>Footer</footer>`;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("main p")!);
    selection.addRange(range);
    const url = new URL(selectedModelFeedbackUrl(document, selection, "https://pkic.org/wg/pqc/pqcmm/")!);
    expect(url.searchParams.get("item-id")).toBe("1.2.3");
    expect(url.searchParams.get("selected-text")).toBe("Original wording");
    expect(url.searchParams.get("source-page")).toContain("#criterion-1-2-3");
    selection.removeAllRanges();
    range.selectNodeContents(document.querySelector("footer")!);
    selection.addRange(range);
    expect(selectedModelFeedbackUrl(document, selection, "https://pkic.org/")).toBeUndefined();
  });
});
