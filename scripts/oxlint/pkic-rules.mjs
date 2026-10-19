// Local Oxlint JS plugin with the repository's architecture rules. The rules use
// the ESLint rule API but do not depend on ESLint. `.oxlintrc.json` loads this
// file as the `pkic` plugin and scopes each rule to its directories.

const isNamed = (node, name) => node?.type === "Identifier" && node.name === name;

// A call such as `db.prepare(...)`: the callee is a member whose property is `name`.
function calledMethod(name, message) {
  return {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        CallExpression(node) {
          if (node.callee?.property && isNamed(node.callee.property, name)) {
            context.report({ node, message });
          }
        },
      };
    },
  };
}

// A JSX opening element whose tag name is matched by `matchesTag`.
function jsxElement(matchesTag, message) {
  return {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name?.type === "JSXIdentifier" && matchesTag(node.name.name)) {
            context.report({ node, message });
          }
        },
      };
    },
  };
}

const newTabLinkTags = new Set(["a", "ButtonLink", "ExternalLink"]);

const rules = {
  "no-sql-in-api-adapter": calledMethod(
    "prepare",
    "API adapters must not prepare SQL; move the query or mutation into a focused service.",
  ),

  "no-d1-batch-in-api-adapter": calledMethod(
    "batch",
    "API adapters must not execute D1 batches; the service must own the complete atomic unit of work.",
  ),

  "no-literal-405": {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        Literal(node) {
          if (node.value === 405) {
            context.report({
              node,
              message:
                "API adapters must use dispatchRequestMethod/dispatchPostOnly so 405 responses and Allow headers stay canonical.",
            });
          }
        },
      };
    },
  },

  // Portal screens and the components they render take their heading level
  // from the outline (ui/HeadingOutline): the shell makes each screen's title
  // the page's one <h1>, a dialog restarts at <h2>, and a public page keeps
  // the authored levels. A literal tag cannot follow that and skips a rung.
  "no-literal-heading": jsxElement(
    (name) => /^h[1-6]$/.test(name),
    "Use SectionHeading (ui/SectionHeading) or a title primitive so the level follows the screen's heading outline.",
  ),

  // Everything under the portal sections, components, and live-session globs
  // renders inside the page's <main>, where an <aside> is a complementary
  // landmark nested in another landmark.
  "no-aside-in-main": jsxElement(
    (name) => name === "aside",
    "Use a <section> with an accessible name, or a <div> for a layout column, inside main.",
  ),

  // A link that leaves the portal opens in a new tab through one policy
  // (ui/new-tab, ExternalLink, ButtonLink, Markdown); screens never set a target.
  "no-link-target": {
    meta: { type: "problem", schema: [] },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name?.type !== "JSXIdentifier" || !newTabLinkTags.has(node.name.name)) return;
          for (const attribute of node.attributes) {
            if (
              attribute.type === "JSXAttribute" &&
              attribute.name?.type === "JSXIdentifier" &&
              attribute.name.name === "target"
            ) {
              context.report({
                node: attribute,
                message:
                  "Do not set a link target. Use ExternalLink or ButtonLink so the new-tab policy and its hint stay in one place.",
              });
            }
          }
        },
      };
    },
  },
};

export default { meta: { name: "pkic" }, rules };
