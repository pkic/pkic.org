import { lazy, Suspense } from "preact/compat";
import { Spinner } from "../Spinner";
import type { MarkdownEditorProps } from "./MarkdownEditor";

const VisualEditor = lazy(() => import("./MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })));

/** Load the editing engine only after the reader chooses to edit. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <VisualEditor {...props} />
    </Suspense>
  );
}
