---
date: 2026-05-07T00:00:00Z
linkTitle: "4 — Managed"
title: "Level 4 (Managed) - PQC Maturity Model (PQCMM)"
description: A product at Level 4 maintains a Cryptographic Bill of Materials (CBOM), supports a zero-legacy configuration, and clearly documents hybrid and composite algorithm support.
summary: Level 4 adds a CBOM, zero-legacy capability, and explicit hybrid/composite support. Suitable for high-assurance and regulated environments.

weight: 50
sectionNav: true
---

## What Level 4 Means

A product at **Level 4** builds on the visibility and agility of Level 3, adding the precision of a **Cryptographic Bill of Materials (CBOM)**, a demonstrated ability to **disable all non-quantum-safe algorithms entirely** while remaining functional, and clarity about **hybrid and composite algorithm support**.

> Level 4 is the benchmark for **high-assurance deployments**. It provides both the documentation precision needed for compliance and the operational capability to enforce a fully quantum-safe configuration.
{.callout-info}

## Criteria

{{< pqcmm-criteria level="4" >}}

## Assessment Questions

{{< pqcmm-assessment-questions level="4" >}}


## Evidence Checklist

{{< pqcmm-evidence-checklist level="4" >}}


## Suggested Procurement Actions

- Request the CBOM and validate it against your organisation's cryptographic policy.
- Confirm zero-legacy capability covers the specific features and protocols in your deployment scenario.
- Clarify hybrid/composite support before designing a hybrid migration architecture.
- Consider requiring Level 4 for certificate authorities, HSMs, identity providers, and other cryptographic root services.
