import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const FRONTEND_ROOT = path.join("assets", "ts");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TRANSPORT_HELPERS = new Map([
  [
    "assets/ts/shared/api-client.ts",
    new Map([
      ["requestJson", 1],
      ["getJson", 1],
      ["postJson", 2],
      ["patchJson", 2],
      ["putJson", 2],
      ["deleteJson", 1],
    ]),
  ],
  ["assets/ts/admin/api.ts", new Map([["api", 1]])],
]);
const PERMISSIVE_SCHEMA_FACTORIES = new Set(["any", "unknown", "custom"]);

function frontendRootFromArguments(arguments_) {
  const rootIndex = arguments_.indexOf("--root");
  if (rootIndex === -1) return process.cwd();
  const root = arguments_[rootIndex + 1];
  if (!root) throw new Error("--root requires a directory path.");
  return path.resolve(root);
}

function collectSourceFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function containsJsonCall(node) {
  let found = false;
  const inspect = (current) => {
    if (found) return;
    if (ts.isCallExpression(current) && propertyName(current.expression) === "json") {
      found = true;
      return;
    }
    ts.forEachChild(current, inspect);
  };
  inspect(node);
  return found;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function transportHelperFromSymbol(symbol, checker, root, seen = new Set()) {
  if (!symbol || seen.has(symbol)) return null;
  seen.add(symbol);

  if (symbol.flags & ts.SymbolFlags.Alias) {
    return transportHelperFromSymbol(checker.getAliasedSymbol(symbol), checker, root, seen);
  }

  for (const declaration of symbol.declarations ?? []) {
    const sourcePath = path.relative(root, declaration.getSourceFile().fileName).split(path.sep).join("/");
    const helpers = TRANSPORT_HELPERS.get(sourcePath);
    if (helpers?.has(symbol.name)) return { name: symbol.name, schemaArgumentIndex: helpers.get(symbol.name) };

    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const helper = transportHelperFromExpression(declaration.initializer, checker, root, seen);
      if (helper) return helper;
    }
  }
  return null;
}

function transportHelperFromExpression(expression, checker, root, seen) {
  const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  return transportHelperFromSymbol(checker.getSymbolAtLocation(lookup), checker, root, seen);
}

function unwrapExpression(expression) {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isPermissiveSchema(expression, checker, seen = new Set()) {
  expression = unwrapExpression(expression);
  if (ts.isCallExpression(expression)) {
    const factoryName = propertyName(expression.expression);
    if (factoryName && PERMISSIVE_SCHEMA_FACTORIES.has(factoryName)) return true;
  }
  if (!ts.isIdentifier(expression)) return false;

  const symbol = checker.getSymbolAtLocation(expression);
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return isPermissiveSchema(declaration.initializer, checker, seen);
    }
  }
  return false;
}

function findViolations(filePath, root, program, checker) {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`Could not load ${filePath} into the TypeScript program.`);
  const violations = [];
  const relativePath = path.relative(root, filePath).split(path.sep).join("/");

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const helper = transportHelperFromExpression(node.expression, checker, root, new Set());
      if (helper && node.typeArguments?.length) {
        violations.push({
          file: relativePath,
          line: lineOf(sourceFile, node),
          message: `Do not call ${helper.name}<T>(); pass the canonical response Zod schema instead.`,
        });
      }
      const schema = helper && node.arguments[helper.schemaArgumentIndex];
      if (schema && isPermissiveSchema(schema, checker)) {
        violations.push({
          file: relativePath,
          line: lineOf(sourceFile, schema),
          message: "Do not pass z.any(), z.unknown(), or z.custom() as an API response schema.",
        });
      }
    }

    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && containsJsonCall(node.expression)) {
      violations.push({
        file: relativePath,
        line: lineOf(sourceFile, node),
        message: "Do not cast a fetch JSON response; validate it with a canonical response Zod schema.",
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function main() {
  const root = frontendRootFromArguments(process.argv.slice(2));
  const frontendDirectory = path.join(root, FRONTEND_ROOT);
  const files = collectSourceFiles(frontendDirectory);
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const violations = files.flatMap((filePath) => findViolations(filePath, root, program, checker));
  if (violations.length === 0) {
    process.stdout.write("Frontend API response contracts are schema-validated.\n");
    return;
  }

  process.stderr.write("Unsafe frontend API response contracts found:\n");
  for (const violation of violations) {
    process.stderr.write(`- ${violation.file}:${violation.line} ${violation.message}\n`);
  }
  process.exitCode = 1;
}

main();
