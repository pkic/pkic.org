import { conditionVariableNames, parseTemplateCondition } from "./template-conditions";
import { assertTemplateRenderDepth, consumeTemplateWork, createTemplateRenderBudget } from "./render-limit";

export interface TemplateVariableReference {
  name: string;
  collection: string | null;
  kind: "value" | "each";
}

/** Inspect every branch and its loop scope without executing any recipient-dependent control flow. */
export function analyzeTemplateReferences(template: string, partials: Record<string, string> = {}) {
  const references = new Map<string, TemplateVariableReference>();
  const invalidTokens: string[] = [];
  const includedPartials = new Set<string>();
  const budget = createTemplateRenderBudget();
  type Block = { kind: string; token: string; collection?: string };

  function inspect(source: string, inheritedCollection: string | null, includePartials: boolean): void {
    consumeTemplateWork(budget, source.length);
    const blocks: Block[] = [];
    const collection = (): string | null => {
      for (let index = blocks.length - 1; index >= 0; index--) {
        if (blocks[index]!.kind === "each") return blocks[index]!.collection ?? inheritedCollection;
      }
      return inheritedCollection;
    };
    const reference = (name: string, kind: TemplateVariableReference["kind"] = "value") => {
      const scope = collection();
      references.set(JSON.stringify([scope, name, kind]), { name, collection: scope, kind });
    };
    for (const match of source.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const token = match[0];
      const expression = match[1]!.trim();
      const opening = /^#(if|unless|each)\s+([\s\S]+)$/.exec(expression);
      if (opening) {
        const [, kind, operand] = opening;
        if (kind === "each") {
          reference(operand!, "each");
          if (collection() || !/^\w+$/.test(operand!)) invalidTokens.push(token);
        } else {
          const names = kind === "if" ? conditionVariableNames(parseTemplateCondition(operand!)) : [operand!];
          for (const name of names) reference(name);
        }
        blocks.push({ kind: kind!, token, ...(kind === "each" ? { collection: operand! } : {}) });
        assertTemplateRenderDepth(blocks.length);
      } else if (expression.startsWith("/")) {
        if (blocks.at(-1)?.kind !== expression.slice(1)) invalidTokens.push(token);
        else blocks.pop();
      } else if (expression === "else") {
        if (!blocks.at(-1) || blocks.at(-1)?.kind === "each") invalidTokens.push(token);
      } else if (expression.startsWith(">")) {
        const name = /^>\s*(\w+)\s*$/.exec(expression)?.[1];
        if (includePartials && name) includedPartials.add(name);
        if (includePartials && name && Object.hasOwn(partials, name)) inspect(partials[name]!, collection(), false);
        else if (!name) invalidTokens.push(token);
      } else if (/^[@\w.]+$/.test(expression)) reference(expression);
      else invalidTokens.push(token);
    }
    invalidTokens.push(...blocks.map((block) => block.token));
  }
  inspect(template, null, true);
  return {
    references: [...references.values()],
    invalidTokens: [...new Set(invalidTokens)],
    includedPartials: [...includedPartials],
  };
}

export function templateVariableNames(
  templates: readonly string[],
  options: { includeLoopBodies?: boolean; partials?: Record<string, string> } = {},
) {
  return [
    ...new Set(
      templates
        .flatMap((template) => analyzeTemplateReferences(template, options.partials).references)
        .filter((reference) => options.includeLoopBodies || reference.collection === null)
        .map((reference) => reference.name)
        .filter((name) => name !== "this" && name !== "." && !name.startsWith("@") && !name.startsWith("this.")),
    ),
  ];
}

export type TemplateReferenceAnalysis = ReturnType<typeof analyzeTemplateReferences>;
