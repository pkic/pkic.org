/**
 * axe in jsdom, reported as one readable line per violated rule.
 *
 * Color contrast is always off: jsdom computes no layout and resolves no
 * custom properties, so a contrast verdict here would be invented. Contrast is
 * a property of the token pairs and is verified against the real values in
 * tests/frontend/design-contrast.test.ts.
 */
import axe from "axe-core";

export async function axeViolations(context: axe.ElementContext, ruleIds?: readonly string[]): Promise<string[]> {
  const results = await axe.run(context, {
    ...(ruleIds ? { runOnly: { type: "rule", values: [...ruleIds] } } : {}),
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
  );
}
