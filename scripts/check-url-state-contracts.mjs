import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootArg = process.argv.indexOf("--root");
const root = rootArg < 0 ? process.cwd() : path.resolve(process.argv[rootArg + 1]);
const files = [];
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file)) files.push(file);
  }
}
walk(path.join(root, "assets/ts"));
const program = ts.createProgram(files, {
  jsx: ts.JsxEmit.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
});
const checker = program.getTypeChecker();
const controls = new Map([
  ["ApiDataTable", { suffix: "/components/ApiDataTable.tsx", prop: "urlState" }],
  ["TabList", { suffix: "/ui/TabList.tsx", prop: "activeId" }],
  ["GridListToggle", { suffix: "/ui/GridListToggle.tsx", prop: "value" }],
]);
const diagnostics = [];
function symbol(node) {
  const found = checker.getSymbolAtLocation(node);
  return found?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
}
const urlOwners = new Set(["useHashQueryParam", "useUrlTableState", "useRouteView", "useUrlQueryState"]);
function urlOwnedCall(call, seen = new Set()) {
  const target = symbol(call.expression);
  if (!target || seen.has(target)) return false;
  seen.add(target);
  if (urlOwners.has(target.name) && target.declarations?.some((d) => d.getSourceFile().fileName.includes("/hooks/")))
    return true;
  let owned = false;
  for (const declaration of target.declarations ?? []) {
    const body = declaration.body;
    if (body)
      visitTree(body, (node) => {
        if (ts.isCallExpression(node) && urlOwnedCall(node, seen)) owned = true;
      });
  }
  return owned;
}
function referencesUrlOwner(expression, seen = new Set()) {
  if (!expression || seen.has(expression)) return false;
  seen.add(expression);
  if (ts.isCallExpression(expression) && urlOwnedCall(expression)) return true;
  if (ts.isIdentifier(expression))
    for (const declaration of symbol(expression)?.declarations ?? []) {
      const variable = ts.isBindingElement(declaration) ? declaration.parent.parent : declaration;
      if (ts.isVariableDeclaration(variable) && referencesUrlOwner(variable.initializer, seen)) return true;
    }
  let found = false;
  ts.forEachChild(expression, (child) => {
    if (referencesUrlOwner(child, seen)) found = true;
  });
  return found;
}
function localState(expression, seen = new Set()) {
  if (!expression || seen.has(expression)) return false;
  seen.add(expression);
  if (ts.isConditionalExpression(expression))
    return (
      localState(expression.whenTrue, seen) ||
      localState(expression.whenFalse, seen) ||
      (!referencesUrlOwner(expression) && localState(expression.condition, seen))
    );
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    referencesUrlOwner(expression.left)
  )
    return localState(expression.left, seen);
  if (ts.isCallExpression(expression)) {
    if (urlOwnedCall(expression)) return false;
    // A loaded collection is data, not navigation state, when URL selection chooses its record.
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "find" &&
      expression.arguments.some((argument) => referencesUrlOwner(argument))
    )
      return false;
    const target = symbol(expression.expression);
    if (
      target?.name === "useState" &&
      target.declarations?.some((d) => /preact\/hooks|hooks\/src/.test(d.getSourceFile().fileName))
    )
      return true;
  }
  if (ts.isIdentifier(expression)) {
    const declarations = symbol(expression)?.declarations ?? [];
    for (const declaration of declarations) {
      if (
        ts.isBindingElement(declaration) &&
        ts.isVariableDeclaration(declaration.parent.parent) &&
        localState(declaration.parent.parent.initializer, seen)
      )
        return true;
      if (ts.isVariableDeclaration(declaration) && localState(declaration.initializer, seen)) return true;
    }
  }
  let found = false;
  ts.forEachChild(expression, (child) => {
    if (localState(child, seen)) found = true;
  });
  return found;
}
function attributeValue(node, name) {
  const attribute = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.text === name);
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
}
const owners = new Map();
function visitTree(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => visitTree(child, visit));
}
// Prop requirements flow through real component symbols, not component filenames.
for (const file of files) {
  visitTree(program.getSourceFile(file), (node) => {
    if (!ts.isFunctionDeclaration(node) && !ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return;
    const name = node.name ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined);
    const owner = name && symbol(name);
    if (owner && node.body) owners.set(owner, node);
  });
}
function canonicalContract(target) {
  const contract = controls.get(target?.name);
  return contract &&
    target.declarations?.some((d) => d.getSourceFile().fileName.replaceAll("\\", "/").endsWith(contract.suffix))
    ? contract
    : undefined;
}
const requirements = new Map();
function parameterProps(expression, owner, seen = new Set()) {
  if (!expression || seen.has(expression)) return [];
  seen.add(expression);
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    if (symbol(expression.expression)?.declarations?.some((d) => ts.isParameter(d) && d.parent === owner))
      return [expression.name.text];
  }
  if (ts.isIdentifier(expression)) {
    for (const declaration of symbol(expression)?.declarations ?? []) {
      if (
        ts.isBindingElement(declaration) &&
        ts.isParameter(declaration.parent.parent) &&
        declaration.parent.parent.parent === owner
      )
        return [declaration.propertyName?.getText() ?? declaration.name.getText()];
      if (ts.isVariableDeclaration(declaration)) return parameterProps(declaration.initializer, owner, seen);
    }
  }
  // Availability predicates do not make a transient context a selected-view binding.
  if (ts.isConditionalExpression(expression))
    return [...parameterProps(expression.whenTrue, owner, seen), ...parameterProps(expression.whenFalse, owner, seen)];
  if (ts.isCallExpression(expression)) return [];
  const props = [];
  ts.forEachChild(expression, (child) => props.push(...parameterProps(child, owner, seen)));
  return props;
}
let expanded = true;
while (expanded) {
  expanded = false;
  for (const [owner, node] of owners) {
    visitTree(node.body, (child) => {
      if (!ts.isJsxOpeningElement(child) && !ts.isJsxSelfClosingElement(child)) return;
      const target = symbol(child.tagName);
      const canonical = canonicalContract(target);
      const props =
        canonical && target.name !== "ApiDataTable" ? [canonical.prop] : [...(requirements.get(target) ?? [])];
      for (const prop of props) {
        for (const passed of parameterProps(attributeValue(child, prop), node)) {
          const required = requirements.get(owner) ?? new Set();
          if (!required.has(passed)) {
            required.add(passed);
            requirements.set(owner, required);
            expanded = true;
          }
        }
      }
    });
  }
}
for (const file of files) {
  const source = program.getSourceFile(file);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const target = symbol(node.tagName);
      const contract = canonicalContract(target);
      if (
        contract &&
        target.declarations?.some((d) => d.getSourceFile().fileName.replaceAll("\\", "/").endsWith(contract.suffix))
      ) {
        const attribute = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.text === contract.prop);
        let message;
        if (
          target.name === "ApiDataTable" &&
          (!attribute ||
            !attribute.initializer ||
            (ts.isStringLiteral(attribute.initializer) && !attribute.initializer.text.trim()))
        )
          message =
            "ApiDataTable requires explicit nonempty urlState namespace ownership; spread-only ownership is not inspectable.";
        const value =
          attribute?.initializer && ts.isJsxExpression(attribute.initializer)
            ? attribute.initializer.expression
            : undefined;
        if (target.name !== "ApiDataTable" && localState(value))
          message = `${target.name}.${contract.prop} is derived from local useState; use a canonical URL/route state binding, or make transient form-panel semantics explicit in its shared contract.`;
        if (message)
          diagnostics.push({
            file: path.relative(root, file),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            control: target.name,
            message,
          });
      }
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      !canonicalContract(symbol(node.tagName))
    ) {
      const target = symbol(node.tagName);
      for (const prop of requirements.get(target) ?? []) {
        if (localState(attributeValue(node, prop)))
          diagnostics.push({
            file: path.relative(root, file),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            control: target.name,
            message: `${target.name}.${prop} forwards local useState into a navigable shared control; bind it to canonical URL/route state.`,
          });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (process.argv.includes("--json"))
  process.stdout.write(JSON.stringify({ diagnostics, count: diagnostics.length }, null, 2) + "\n");
else {
  for (const d of diagnostics) process.stderr.write(`${d.file}:${d.line}: ${d.message}\n`);
  process.stdout.write(`URL-state contract findings: ${diagnostics.length}\n`);
}
if (diagnostics.length) process.exitCode = 1;
