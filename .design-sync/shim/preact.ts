// Sync-only shim: maps the Preact runtime API onto React for the design-sync
// bundle. The DS source imports `preact`; claude.ai/design renders with React,
// and Preact vnodes are rejected by React 19 ($$typeof mismatch:
// Symbol(react.element) vs Symbol(react.transitional.element)). Aliasing at
// bundle time yields genuine React components instead.
// `ui/` uses only createElement and Fragment at runtime; everything else it
// imports from "preact" is `import type`, erased before this file is reached.
export { createElement, Fragment, Component, cloneElement, createContext, createRef, isValidElement } from "react";
export { createElement as h } from "react";
export type { ReactNode as ComponentChildren } from "react";
// `ui/` writes `JSX.ButtonHTMLAttributes<…>` / `JSX.CSSProperties` against
// Preact's JSX namespace; React's is structurally the same for these.
export type { JSX } from "react";

// `preact`'s `render` has no React equivalent (React mounts via
// react-dom/client, which is externalized to window.ReactDOM here). The only
// DS file importing it is `ui/preview/preview-page.tsx`, the repo's own dev
// harness, whose `main()` returns early when `#pk-preview` is absent — which it
// always is inside a preview card. So this exists to satisfy the import and is
// never reached; throwing keeps a real misuse loud instead of silent.
export function render(): never {
  throw new Error("[design-sync] preact `render` is not available in the React-aliased DS bundle.");
}
