// Sync-only shim: `preact/hooks` -> React. Every hook `ui/` uses
// (useState, useEffect, useRef, useCallback, useId, useLayoutEffect)
// has identical semantics in React.
export { useState, useEffect, useRef, useMemo, useCallback, useContext, useReducer, useLayoutEffect, useId, useImperativeHandle, useDebugValue } from "react";
