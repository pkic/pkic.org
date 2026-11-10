---
date: 2026-05-07T00:00:00Z
linkTitle: "3 — Advanced"
title: "Level 3 (Advanced) - PQC Maturity Model (PQCMM)"
description: A product at Level 3 maintains a full cryptographic inventory, documents non-quantum-safe features as risks, produces an SBOM, and has crypto-agility mechanisms for key features.
summary: Level 3 adds full cryptographic visibility and agility. Vendors can account for all cryptographic use cases and update algorithms without major redesign.

weight: 40
---

## What Level 3 Means

{{< model-section title="What Level 3 Means" >}}

## Criteria

{{< model part="criteria" >}}

### Cryptographic Inventory Taxonomy

{{< model-section title="Cryptographic Inventory Taxonomy" >}}

## Assessment Questions

{{< model-section title="Assessment approach" >}}

{{< model part="methodology" >}}

{{< model part="questions" >}}

## Evidence Checklist

{{< model part="evidence" >}}

## Suggested Procurement Actions

- Request the SBOM and verify cryptographic library versions against known vulnerabilities.
- Assess whether crypto-agility mechanisms cover the use cases most relevant to your integration.
- Use the non-quantum-safe feature register as input into your own cryptographic risk register.
- Consider requiring Level 3 for any system involved in long-term data archival, identity issuance, or critical infrastructure.

