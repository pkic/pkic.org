import type { Extensions } from "@tiptap/core";
import { useEffect, useState } from "preact/hooks";
import type { MarkdownEditorProfile } from "./basic-editor-extensions";

/** Basic fields do not load the page-layout and media extension module. */
export function useEditorExtensions(profile: MarkdownEditorProfile) {
  const [loaded, setLoaded] = useState<{ profile: MarkdownEditorProfile; extensions: Extensions } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    const load =
      profile === "basic"
        ? import("./basic-editor-extensions").then((module) => module.basicEditorExtensions())
        : import("./editor-extensions").then((module) => module.editorExtensions("content"));
    void load.then(
      (extensions) => {
        if (active) setLoaded({ profile, extensions });
      },
      (failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error ? failure : new Error("Unable to load editor formatting.", { cause: failure }),
          );
      },
    );
    return () => {
      active = false;
    };
  }, [profile]);
  if (error) throw error;
  return loaded?.profile === profile ? loaded.extensions : null;
}
