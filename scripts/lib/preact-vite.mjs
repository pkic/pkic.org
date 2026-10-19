/**
 * The Preact settings every Vite build of the browser code shares: Preact's
 * JSX runtime for `.tsx`, and React imports redirected to Preact's
 * compatibility layer so React-peer libraries (e.g. wouter) use Preact.
 */
/** @type {import("vite").ESBuildOptions} */
export const preactEsbuild = { jsx: "automatic", jsxImportSource: "preact" };

export const preactAlias = {
  react: "preact/compat",
  "react-dom/test-utils": "preact/test-utils",
  "react-dom": "preact/compat",
  "react/jsx-dev-runtime": "preact/jsx-runtime",
  "react/jsx-runtime": "preact/jsx-runtime",
};
