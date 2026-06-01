---
date: 2026-05-07T00:00:00Z
linkTitle: "Evaluation"
title: "Evaluation - PQC Maturity Model (PQCMM)"
description: A structured approach to scoring and evaluating vendors using the PQCMM framework.
summary: Remove the heavy lifting from your procurement team by relying directly on the PQCMM maturity levels and independent assurance methods.
weight: 30
---

## Evaluation Process

The core purpose of the PQC Maturity Model is to remove the burden of manual cryptographic capability assessment from procurement and vendor-risk teams. You should not need to grade the nuance of cryptographic evidence—that is the purpose of the assessment process and the resulting PQCMM level.

To evaluate a vendor, use a gate-driven approach based entirely on the vendor's PQCMM report.

### 1. Mandatory Gates (Pass/Fail)

Before applying any subjective scoring, ensure the vendor's submission meets your baseline requirements.

| Gate | Pass condition |
|---|-----|
| **Assessment Report** | The vendor has provided a formal PQCMM assessment or certification report. |
| **Product Scope** | The report explicitly covers the exact product, version, and deployment model being procured. |
| **Minimum Level** | The achieved level meets your predefined minimum requirement (e.g., Level 2 or Level 3). |
| **Required Assurance** | The assurance method (Self-Assessed, Third-Party, or Certified) meets the requirement for the supplier's [risk tier](/wg/pqc/pqcmm/adoption/inventory/#supplier-risk-tiers). |
| **Authenticity** | The report is authentic (independently verified via digital signature or the PKIC Certified Products registry). |

If a response fails a mandatory gate, it should be treated as non-compliant or routed through your organization's standard exception process.

### 2. Level-Based Scoring

If you need to rank eligible vendors who have passed the mandatory gates, base your scoring primarily on the fully achieved PQCMM level. Because the levels (1–5) are cumulative, a higher fully met level inherently means more rigorous criteria have been satisfied.

Do not award partial credit or "roadmap points" toward the current level. If a vendor is at Level 2 and promises Level 3 in six months, their current score is Level 2.

### 3. Assurance as a Differentiator

When two vendors claim the same level, the **Assurance Method** serves as your primary differentiator. 

| Assurance Method | Confidence Level | Evaluation Guidance |
|---|-----|-------|
| Self-Assessment | Baseline | Rely on this only for low-to-moderate risk procurements where independent verification is not feasible. |
| Third-Party Assessment | High | Strongly preferred. The claims have been validated by an independent assessor. Treat this as significantly more reliable than a self-assessment. |
| PKI Consortium Certified | Highest | The gold standard. The assessment has been independently conducted by accredited assessors and the conformance has been certified by the PKI Consortium. |

If Vendor A provides a **Self-Assessed Level 3**, and Vendor B provides a **Third-Party Assessed Level 3**, Vendor B provides significantly higher confidence and should score higher in your evaluation.

## Removing Evidence Grading from Procurement

In the past, procurement teams had to manually evaluate the quality of a vendor's "marketing claims" versus actual cryptographic evidence. **With the PQCMM, this is no longer your job.**

The responsibility of gathering, verifying, and mapping evidence belongs to the assessment process (whether conducted by the vendor internally or by a third party). Procurement teams should rely on the output of that process: the PQCMM Level and the Assurance Method. 

### Verifying the Report (The New Evidence)

When you rely on a Third-Party Assessment or PKI Consortium Certification, the **assessment report itself becomes your primary evidence**. Your only remaining requirement is to verify its authenticity. This entirely shifts the burden away from cryptographic analysis to simple credential checking:

- **Check Digital Signatures:** Ensure the PDF report carries a valid digital signature from the PKI Consortium. If you are accepting a Third-Party Assessment that is not formally certified, ensure it carries a valid digital signature from the accredited independent assessor.
- **Consult the Registry:** For certified products, quickly check the [Certified Products](/wg/pqc/pqcmm/products/) registry on the PKI Consortium website to confirm the product's standing and view its assessed level.

If you require higher confidence that the underlying technical evidence was thoroughly checked, do not attempt to evaluate the documentation yourself—instead, **demand a higher Assurance Method** (Third-Party Assessment or Certification) as a mandatory gate.

