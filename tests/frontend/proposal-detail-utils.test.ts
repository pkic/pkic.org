import { describe, expect, it } from "vitest";
import { buildProposalAnswerRows } from "../../assets/ts/admin/sections/events/detail/proposal-detail-utils";
import type { AdminFormDetailField } from "../../assets/ts/admin/types";

const formFields: AdminFormDetailField[] = [
  {
    id: "field-audience",
    key: "audience",
    label: "Target audience",
    fieldType: "text",
    required: true,
    options: null,
    validation: null,
    sortOrder: 1,
  },
  {
    id: "field-format",
    key: "format",
    label: "Preferred format",
    fieldType: "select",
    required: true,
    options: [
      { value: "talk", label: "Talk" },
      { value: "panel", label: "Panel discussion" },
    ],
    validation: null,
    sortOrder: 2,
  },
  {
    id: "field-tracks",
    key: "tracks",
    label: "Tracks",
    fieldType: "multi_select",
    required: false,
    options: [
      { value: "pki", label: "PKI" },
      { value: "policy", label: "Policy" },
    ],
    validation: null,
    sortOrder: 3,
  },
  {
    id: "field-recording",
    key: "recordingConsent",
    label: "Recording consent",
    fieldType: "boolean",
    required: false,
    options: null,
    validation: null,
    sortOrder: 4,
  },
];

describe("proposal detail answer helpers", () => {
  it("formats labeled proposal answers using the active form", () => {
    const rows = buildProposalAnswerRows(
      {
        audience: "Operators",
        format: "panel",
        tracks: ["pki", "policy"],
        recordingConsent: true,
      },
      formFields,
    );

    expect(rows).toEqual([
      {
        key: "audience",
        label: "Target audience",
        values: ["Operators"],
        kind: "text",
      },
      {
        key: "format",
        label: "Preferred format",
        values: ["Panel discussion"],
        kind: "text",
      },
      {
        key: "tracks",
        label: "Tracks",
        values: ["PKI", "Policy"],
        kind: "list",
      },
      {
        key: "recordingConsent",
        label: "Recording consent",
        values: ["Yes"],
        kind: "text",
      },
    ]);
  });

  it("falls back to raw keys and pretty-printing for unknown answers", () => {
    const rows = buildProposalAnswerRows(
      {
        notes: "Bring deployment examples",
        metadata: { region: "eu", size: 300 },
      },
      formFields,
    );

    expect(rows).toEqual([
      {
        key: "metadata",
        label: "metadata",
        values: ['{\n  "region": "eu",\n  "size": 300\n}'],
        kind: "pre",
      },
      {
        key: "notes",
        label: "notes",
        values: ["Bring deployment examples"],
        kind: "text",
      },
    ]);
  });
});
