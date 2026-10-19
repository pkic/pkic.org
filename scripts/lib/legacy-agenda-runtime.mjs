import * as module from "node:module";
/** Native strip-types needs extension resolution for the existing canonical schema graph. */
export function registerLegacyAgendaSchemaResolution() {
  if (typeof module.registerHooks !== "function")
    throw new Error("Agenda preparation requires Node 22.15 or newer with native module hooks.");
  const sharedRoot = new URL("../../assets/shared/", import.meta.url).href;
  return module.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (
          error.code !== "ERR_MODULE_NOT_FOUND" ||
          !context.parentURL?.startsWith(sharedRoot) ||
          !specifier.startsWith(".") ||
          /\.[a-z]+$/iu.test(specifier)
        )
          throw error;
        return nextResolve(`${specifier}.ts`, context);
      }
    },
  });
}
