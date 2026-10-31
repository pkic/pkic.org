import { mcpExecutionAuthorizationEvidence } from "./authorization-evidence";
import { prepareUserBackedAdminFromRequest } from "../auth/admin";
import { guardDatabaseBatches } from "../db/guarded-database";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../types";

/** Transport authority shares the API's snapshot; mutation refusal rolls back that same command. */
export async function prepareMcpRequestAuthorization(db: DatabaseLike, request: Request, env: Env) {
  const actor = await prepareUserBackedAdminFromRequest(db, request, env);
  const evidence = actor ? mcpExecutionAuthorizationEvidence(actor) : null;
  let validated = false;
  let resolvedActor: UserBackedAuthAdmin | undefined;
  let failure: Error | undefined;
  const checkFailure = (error: unknown): never => {
    failure = isAuthorizationGuardFailure(error)
      ? new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again")
      : error instanceof Error
        ? error
        : new Error("MCP authorization failed", { cause: error });
    throw failure;
  };
  const guarded = actor
    ? guardDatabaseBatches(db, async (statements, readOnly) => {
        try {
          const guards = readOnly
            ? [db.prepare(`SELECT EXISTS(${evidence!.sql}) AS authorized`).bind(...evidence!.bindings)]
            : [prepareAuthorizationGuard(db, evidence!)];
          const loaded = await db.batch([...guards, ...actor.statements, ...statements]);
          if (readOnly && loaded[0]?.results?.[0]?.authorized !== 1)
            throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
          resolvedActor = await actor.decode(loaded.slice(guards.length, guards.length + actor.statements.length));
          validated = true;
          return loaded.slice(guards.length + actor.statements.length);
        } catch (error) {
          return checkFailure(error);
        }
      })
    : db;
  return {
    actor: actor
      ? {
          ...actor,
          statements: [],
          async decode() {
            if (!resolvedActor) throw new Error("Request authority must be resolved in the resource batch");
            return resolvedActor;
          },
        }
      : null,
    db: { ...guarded, ...(db.getBookmark ? { getBookmark: () => db.getBookmark!() } : {}) },
    async finish() {
      if (failure) throw failure;
      if (!actor || validated) return;
      try {
        const loaded = await db.batch([
          db.prepare(`SELECT EXISTS(${evidence!.sql}) AS authorized`).bind(...evidence!.bindings),
          ...actor.statements,
        ]);
        if (loaded[0]?.results?.[0]?.authorized !== 1)
          throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
        resolvedActor = await actor.decode(loaded.slice(1));
        validated = true;
      } catch (error) {
        checkFailure(error);
      }
    },
  };
}
