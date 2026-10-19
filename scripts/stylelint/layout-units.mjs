import stylelint from "stylelint";

const {
  createPlugin,
  utils: { report, ruleMessages },
} = stylelint;

export const ruleName = "pkic/layout-units";

export const messages = ruleMessages(ruleName, {
  rejected: (property, value) =>
    `Use a design token, rem, or a relative unit for ${property} instead of ${value}; px is for hairlines of 2px or less.`,
});

// Type, spacing, size, and position follow the reader's text size, so they are
// set in tokens or rem. Borders, outlines, shadows, blurs, radii, and nudges in
// a transform are hairline detail and stay in px.
const layoutProperty =
  /^(font-size|line-height|letter-spacing|padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|flex-basis|grid-template-columns|grid-template-rows|grid-auto-columns|grid-auto-rows|(min-|max-)?(width|height|inline-size|block-size))(-.*)?$/;
const hairline = 2;

/** Every px length in a value larger than a hairline (font sizes have no hairline). */
export function rejectedLengths(property, value) {
  if (!layoutProperty.test(property)) return [];
  const limit = property.startsWith("font-size") ? 0 : hairline;
  return [...value.matchAll(/(?<![\w-])(-?\d*\.?\d+)px\b/g)]
    .filter((match) => Math.abs(Number(match[1])) > limit)
    .map((match) => match[0]);
}

const ruleFunction = (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    for (const length of rejectedLengths(property, declaration.value)) {
      report({
        result,
        ruleName,
        node: declaration,
        word: length,
        message: messages.rejected(property, length),
      });
    }
  });
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

export default createPlugin(ruleName, ruleFunction);
