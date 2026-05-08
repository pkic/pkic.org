---
date: 2026-05-07T00:00:00Z
linkTitle: "Large Organizations"
title: "Large Organization Playbook - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: A practical adoption playbook for large organizations integrating the Post-Quantum Cryptography Maturity Model into procurement, vendor-risk, and architecture-review processes.
summary: Integrate the model into supplier questionnaires, procurement templates, vendor-risk records, architecture reviews, renewals, and contract milestones.
weight: 20
---

## Integrate with Existing Processes

Large organizations normally already have procurement, vendor-risk, security architecture, and legal processes. Add PQCMM requirements to those processes instead of creating a separate programme.

## Continuous Prioritization

The long-term objective is for all in-scope suppliers to achieve **[Level 5 (Optimized)](/wg/pqc/pqcmm/levels/5-optimized/)**. Moving a massive supply chain is a continuous process, so prioritize your efforts based on risk and data lifespan.

- **Baseline the entire supply chain**: Add mandatory assessment intake questions to all supplier questionnaires and renewal templates. Ask everyone, but focus your manual follow-ups on the highest risk tiers.
- **Define supplier tiers**: Categorize your vendors based on data sensitivity, data lifespan, and operational criticality. Identify the critical infrastructure providers (cloud, IAM, VPNs, HSMs, payment, and core SaaS) that need immediate assessment.
- **Run targeted campaigns**: Actively chase assessment reports from your Tier 1 and Tier 2 suppliers first. 
- **Set procurement floors**: Require assessment reports for all new high-risk procurements. Define minimum acceptable levels for new contracts.
- **Address HNDL exposure**: Products protecting long-lived sensitive data (e.g., health records, financial history, state secrets) must not remain at [Level 0](/wg/pqc/pqcmm/levels/0-none/). Escalate these immediately to mitigate **Harvest Now, Decrypt Later (HNDL)** risk.
- **Track progress**: Add the PQCMM level, assurance method, report date, and evidence status to your central vendor-risk records to monitor the journey to [Level 5](/wg/pqc/pqcmm/levels/5-optimized/).

## Buy, Evaluate, Contract, Monitor

| Step | Practical action |
|---|---|
| Buy | Add level and assurance requirements to procurement templates |
| Evaluate | Use mandatory gates before scoring vendor responses |
| Contract | Include reassessment triggers and roadmap milestones for suppliers below target |
| Monitor | Track exceptions and supplier progress in vendor-risk tooling |

## Minimum Policy

Require self-assessment for all in-scope suppliers, third-party assessment for high-criticality suppliers, and contract milestones for suppliers below the required level.

