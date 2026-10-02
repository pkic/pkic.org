import { expect, it } from "vitest";
import { plainText } from "../../assets/shared/markdown-plain-text";

it("keeps readable conference descriptions without Markdown syntax", () => {
  expect(plainText("**We will explore:**\n* Build a [PQC PKI](https://example.test/).\n_Hands-on activities._")).toBe(
    "We will explore: Build a PQC PKI. Hands-on activities.",
  );
  expect(plainText("![Logo](logo.svg) `ML-KEM` and <example> remain text")).toBe("ML-KEM and <example> remain text");
});
