/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies obscure ownership and make changes harder to isolate.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      comment: "All imports except documented runtime-provided virtual modules must resolve.",
      severity: "error",
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: "^(cloudflare:workers|/pagefind/pagefind\\.js|js/bootstrap)$",
      },
    },
    {
      name: "shared-is-runtime-neutral",
      comment: "Shared contracts cannot depend on backend or frontend implementation.",
      severity: "error",
      from: { path: "^assets/shared" },
      to: { path: "^(functions|assets/ts)" },
    },
    {
      name: "backend-does-not-import-frontend",
      comment: "Backend code may use shared contracts but cannot import browser implementation.",
      severity: "error",
      from: { path: "^functions" },
      to: { path: "^assets/ts" },
    },
    {
      name: "frontend-does-not-import-backend",
      comment: "Frontend code may use shared contracts but cannot import Worker implementation.",
      severity: "error",
      from: { path: "^assets/ts" },
      to: { path: "^functions" },
    },
    {
      name: "frontend-shared-does-not-import-features",
      comment:
        "Reusable frontend presentation, hooks, and clients cannot depend on an admin, event, or member feature.",
      severity: "error",
      from: { path: "^assets/ts/(components|hooks|shared)(/|$)" },
      to: { path: "^assets/ts/(admin|event-flows|member-flows)(/|$)" },
    },
    {
      name: "backend-libraries-do-not-import-routes",
      comment: "Backend libraries and use cases cannot depend on HTTP route adapters.",
      severity: "error",
      from: { path: "^functions/_lib" },
      to: { path: "^functions/api" },
    },
    {
      name: "routes-do-not-import-audit-infrastructure",
      comment: "HTTP adapters must call a use case that owns the business operation and its audit record.",
      severity: "error",
      from: { path: "^functions/api" },
      to: { path: "^functions/_lib/services/audit$" },
    },
    {
      name: "generic-email-does-not-import-feature-services",
      comment: "Generic email infrastructure cannot depend on feature use cases.",
      severity: "error",
      from: { path: "^functions/_lib/email" },
      to: { path: "^functions/_lib/services" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "browser", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
