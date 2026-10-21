import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { readableModelSchema } from "../../site/model-version-source";
import { modelVersionTree } from "../../site/model-version-navigation";

it("retains the shared menu while keeping level and overview links within the selected version", () => {
  const model = readableModelSchema.parse(parse(readFileSync("tests/fixtures/model-preview.yaml", "utf8")));
  const root = "/wg/pqc/pqcmm/versions/1.0.1/";
  const tree = modelVersionTree(
    {
      root: { href: "/wg/pqc/pqcmm/", label: "Model", current: false },
      sections: [
        { href: "/wg/pqc/pqcmm/levels/", label: "Maturity levels", current: false },
        { href: "/wg/pqc/pqcmm/version-history/", label: "Version History", current: false },
      ],
    },
    model,
    "/wg/pqc/pqcmm/",
    root,
    root,
  );
  expect(tree.root).toMatchObject({ href: root, current: true });
  expect(tree.sections[0]?.children?.length).toBe(model.levels.length);
  expect(tree.sections[0]?.children?.every((node) => node.href.startsWith(root))).toBe(true);
  expect(tree.sections[1]?.href).toBe("/wg/pqc/pqcmm/version-history/");
});
