import type { Executor, ExecuteResult } from "@cloudflare/codemode";

const instruction =
  "Return exactly one codemode.request(...) operation. Use separate execute calls for dependent API operations and process the returned result outside execute.";

/** Plan before dispatch: refusing a chain must never leave its first mutation committed. */
export function singleOperationExecutor(executor: Executor): Executor {
  return {
    async execute(code, providers): Promise<ExecuteResult> {
      if (!Array.isArray(providers) || providers.length === 0) return executor.execute(code, providers);
      const marker = crypto.randomUUID();
      const planned: { dispatch: (...args: unknown[]) => Promise<unknown>; args: unknown[] }[] = [];
      const planners = providers.map((provider) => ({
        ...provider,
        fns: Object.fromEntries(
          Object.entries(provider.fns).map(([name, dispatch]) => [
            name,
            async (...args: unknown[]) => {
              planned.push({ dispatch, args });
              if (planned.length > 1) throw new Error(instruction);
              return { operation: marker };
            },
          ]),
        ),
      }));
      const result = await executor.execute(code, planners);
      if (result.error) return result;
      let operation = result.result;
      if (typeof operation === "string") {
        try {
          operation = JSON.parse(operation);
        } catch {
          operation = null;
        }
      }
      if (
        planned.length !== 1 ||
        !operation ||
        typeof operation !== "object" ||
        Array.isArray(operation) ||
        Object.keys(operation).length !== 1 ||
        (operation as { operation?: unknown }).operation !== marker
      )
        return { result: null, error: instruction };
      try {
        return { ...result, result: await planned[0]!.dispatch(...planned[0]!.args) };
      } catch (error) {
        return { result: null, error: error instanceof Error ? error.message : "API operation failed" };
      }
    },
  };
}
