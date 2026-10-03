const SESSION_TYPE_LABELS: Readonly<Record<string, string>> = {
  talk: "Talk",
  keynote: "Keynote",
  panel: "Panel",
  workshop: "Workshop",
  tutorial: "Tutorial",
  lightning_talk: "Lightning talk",
  roundtable: "Roundtable",
  birds_of_a_feather: "Birds of a feather",
  fireside_chat: "Fireside chat",
  demo: "Demo",
};

/** Preserve familiar labels while accepting event-defined session types. */
export function proposalSessionTypeLabel(type: string): string {
  return SESSION_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}
