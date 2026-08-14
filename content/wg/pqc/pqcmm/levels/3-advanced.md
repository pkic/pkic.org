---
date: 2026-05-07T00:00:00Z
linkTitle: "3 — Advanced"
title: "Level 3 (Advanced) - PQC Maturity Model (PQCMM)"
description: A product at Level 3 maintains a full cryptographic inventory, documents non-quantum-safe features as risks, produces an SBOM, and has crypto-agility mechanisms for key features.
summary: Level 3 adds full cryptographic visibility and agility. Vendors can account for all cryptographic use cases and update algorithms without major redesign.

weight: 40
sectionNav: true
---

## What Level 3 Means

A product at **Level 3** has moved beyond simply offering quantum-safe features — it provides the **cryptographic transparency and architectural flexibility** needed for organizations to manage their migration systematically.

The vendor has catalogued every cryptographic use case in the product, explicitly acknowledged which ones are not yet quantum-safe, and built mechanisms that allow algorithm updates without requiring a complete architectural overhaul.

> Level 3 gives organizations the **visibility to plan** and the **agility to execute** a controlled cryptographic migration.
{.callout-info}

## Criteria

{{< pqcmm-criteria level="3" >}}

### Cryptographic Inventory Taxonomy

A Level 3 cryptographic inventory must cover, at minimum, the following categories. For each category, list the algorithms, parameter sets, and components used — or mark the category *not applicable* with a justification:

- Data in transit (e.g., TLS, VPN, application protocols)
- Data at rest (e.g., disk, database, object storage encryption)
- Identity, authentication, and certificates
- Code, firmware, and update signing
- Key wrapping and key-encryption keys (KEKs)
- Random number generation and entropy sources
- Telemetry, logging, and audit-trail integrity
- Build, CI/CD, and supply-chain signing (where part of the product)
- Attestation and remote-attestation (where applicable)
- Backup, archival, and long-term storage

## Assessment Questions

{{< pqcmm-assessment-questions level="3" >}}


## Evidence Checklist

{{< pqcmm-evidence-checklist level="3" >}}


## Suggested Procurement Actions

- Request the SBOM and verify cryptographic library versions against known vulnerabilities.
- Assess whether crypto-agility mechanisms cover the use cases most relevant to your integration.
- Use the non-quantum-safe feature register as input into your own cryptographic risk register.
- Consider requiring Level 3 for any system involved in long-term data archival, identity issuance, or critical infrastructure.
