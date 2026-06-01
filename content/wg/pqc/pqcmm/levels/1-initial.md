---
date: 2026-05-07T00:00:00Z
linkTitle: "1 — Initial"
title: "Level 1 (Initial) - PQC Maturity Model (PQCMM)"
description: A product at Level 1 has quantum-safe algorithms available for testing and evaluation, typically via manual configuration or beta features.
summary: Level 1 means PQC is available for testing and evaluation. The vendor has started the journey — integration teams can begin compatibility assessments.

weight: 20
sectionNav: true
---

## What Level 1 Means

A product at **Level 1** has taken the first concrete step in its PQC journey. Quantum-safe algorithms or features exist within the product, but are not yet production-ready — they are available for evaluation, testing, and proof-of-concept work.

This level signals genuine vendor investment and creates the opportunity for integration teams to begin technical assessments before production availability. It is the minimum level at which meaningful interoperability testing can begin.

> Level 1 is the **first evidence** that a vendor is actively engaging with PQC. Organizations can begin technical evaluation and build integration knowledge while awaiting production readiness.
{.callout-info}

## Criteria

{{< criteria >}}
A product meets Level 1 when **all** of the following are true:

- At least one quantum-safe algorithm is available in a released build (stable, beta, preview, or experimental).
- The feature can be enabled — typically manually, via a configuration flag, or through a dedicated beta/preview channel.
- The vendor has documented how to enable and use the quantum-safe feature for evaluation purposes.
{{< /criteria >}}

Level 1 does **not** require the feature to be production-ready, standards-compliant, or enabled by default. Level 1 is intentionally permissive: any post-quantum algorithm available in a released build qualifies. Standards conformance is introduced at [Level 2](/wg/pqc/pqcmm/levels/2-basic/).

## Assessment Questions

For each question, require the vendor to provide specifics. A general "yes" is not sufficient — look for algorithm names, parameter sets, component names, and documentation references. A response that cannot name the algorithm or provide a URL is not assessable.

### Assessment methodology record

The assessment report must record:

- **Evidence method** — documentation review, functional reproduction, or both.
- **Cryptographic library** — library name and exact version; whether the library version's PQC support was independently confirmed from a public source; whether the library is currently maintained.
- **Reproduction attempts** — for each: product version, environment type (vendor sandbox / trial licence / own installation), date, and outcome (succeeded / failed / partially reproduced).
- **Documents reviewed** — for each: URL or reference, the product version it covers, and the date accessed.
- **Unverified claims** — flag each explicitly as *"vendor-stated, not independently verified"*.

> Every claim at Level 1 must be backed by a URL or document reference accessible to the assessor. Vendor-only demonstrations that the assessor cannot independently reproduce must be flagged.
{.callout-info}

### Algorithm Availability

| # | Question | Assessment guidance |
|--|-----|-------|
| 1.2.1 | Which quantum-safe algorithms are available for testing and evaluation? | Record exact algorithm names and parameter sets (e.g., ML-KEM-768, ML-DSA-65 — not just "ML-KEM" or "PQC"). Request two URLs: (a) the product documentation page describing the feature; (b) the release notes for the version that introduced it. Both must be accessible to the assessor and must cover the assessed product version — not a future or generic version. Record the product version, both URLs, and the date accessed. |
| 1.2.2 | Which release channel provides access — stable, beta, preview, or experimental? | Record the channel name, the release identifier (version number or build tag), and whether access is public or requires programme enrolment. Request the public announcement URL or enrolment page URL. Record the URL and date accessed. |
| 1.2.3 | Is the feature available to all customers or only to a subset? | Record the access model as stated in the vendor's written documentation or announcement — quote the relevant text with the source URL. Any restriction must be sourced from a written document, not paraphrased from a verbal claim. |
| 1.2.4 | Is the quantum-safe feature accessible without custom builds or source-code modification? | The assessor should attempt to reproduce the access path using the standard product release, following the documented steps. Record: the steps followed, the product version, the environment, and whether the reproduction succeeded. A feature that cannot be accessed by following its published documentation fails this check. |

### Component Coverage

| # | Question | Assessment guidance |
|---|---|---|
| 1.3.1 | In which product components or functional areas is the quantum-safe feature implemented — e.g., TLS, firmware update signing, certificate issuance, key generation, key exchange? | Request a written component map or architecture document. Record each named component with the algorithm and parameter set it uses. A general claim ("PQC is used in TLS") without component-level attribution does not meet this criterion. Ask specifically about high-risk areas: firmware signing, certificate issuance, root key operations. |
| 1.3.2 | What cryptography is used in each identified component, and where — including low-level components such as firmware or bootloader? | Record each component with algorithm name, parameter set, and usage context (e.g., "ML-DSA-65 — firmware update package signing — applied at build time"). A product with firmware that has no firmware entry in this list requires an explanation — record the gap and the vendor's justification. |
| 1.3.3 | Are there product components where quantum-safe support is explicitly not planned at this stage? | Record each out-of-scope component, the classical algorithm currently in use, and the vendor's stated reason — with a document reference if available. "Not yet planned" as a general disclaimer without naming specific components is not sufficient. |

### Configuration & Enablement

| # | Question | Assessment guidance |
|---|---|---|
| 1.4.1 | How is the quantum-safe feature enabled? Provide the specific configuration step, flag name, or API parameter. | Record the exact mechanism — configuration key, flag name, or API parameter name — and the documentation URL. Where possible, reproduce the enablement step in a test environment and record the outcome. A feature that cannot be enabled by following its published documentation is a finding. |
| 1.4.2 | Is the enablement process documented in official product documentation? Provide the URL and section reference. | Record the documentation URL and confirm it is accessible for the assessed product version (not a newer release or generic page). Documentation that exists only in an internal wiki or internal knowledge base does not satisfy this criterion — it must be accessible to customers. |

### Evidence & Testing

| # | Question | Assessment guidance |
|---|---|---|
| 1.5.1 | Does the product implement quantum-safe algorithms via a third-party cryptographic library, or through a custom in-house implementation? If a library is used, which library and exact version? | Most products rely on a well-known cryptographic library rather than writing cryptographic primitives from scratch — implementing cryptography in-house is strongly discouraged and rare in commercial products. Common libraries include OpenSSL (with or without oqs-provider), wolfSSL, Bouncy Castle, AWS-LC, Microsoft CNG / BCryptPrimitives, NSS, mbedTLS, LibreSSL, Botan, and Crypto++. Record: **(a)** library name and exact version string as reported by the vendor; **(b)** the URL from the library's own official release notes, changelog, or PQC documentation page confirming that the identified version supports the specific claimed quantum-safe algorithm — the assessor must verify this independently, not accept the vendor's assertion alone; **(c)** whether the library version is currently maintained and eligible for security patches (record the library's support policy URL). If the vendor claims a custom implementation, record the justification and apply heightened scrutiny to question 1.5.2. |
| 1.5.2 | Can the vendor provide an artefact confirming the implementation — such as test vectors, NIST Known Answer Test (KAT) results, an interoperability report, or a lab result? | **If the product uses a third-party cryptographic library (see question 1.5.1):** the library's own validation records are the primary artefact — record the library name, version, and any NIST CAVP/CMVP validation certificate for that library. Verify independently that the assessed library version is within the validated module boundary. **If the product uses a custom implementation:** require stronger artefacts. Artefacts in descending order of evidential weight: **(a)** NIST CAVP/ACVTS validation results (https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program) — record the algorithm, validation URL, and result identifier; **(b)** KAT result file against NIST reference vectors — record the file URL or repository URL with commit hash; **(c)** interoperability test report naming the tested implementation, version, protocol, and outcome; **(d)** publicly accessible open-source repository — record the URL and commit hash, and note whether the assessor reviewed or tested the code. A vendor white paper without underlying test data is weaker evidence — record it and flag its limitations. |
| 1.5.3 | Can the quantum-safe feature be exercised in a test or sandbox environment accessible to the assessor? | The assessor must attempt to exercise the feature independently. Record: environment type (vendor-hosted sandbox / trial licence / own installation), product version, the specific algorithm exercised, the test procedure, and the outcome. A feature that could only be observed in a vendor-controlled demonstration must be flagged as "vendor-demonstrated, not independently reproduced". |
| 1.5.4 | Has the vendor documented known interoperability limitations or incompatibilities with this quantum-safe implementation? | Record the URL or document reference for any known limitations list. If no such document exists, record the date and source of the vendor's written confirmation that no known limitations exist. Any incompatibility discovered by the assessor during independent testing that is not in the vendor's documentation is a finding — record it explicitly. |

### Roadmap

| # | Question | Assessment guidance |
|---|---|---|
| 1.6.1 | Does the vendor have a roadmap for progression to production readiness (Level 2)? What is the target release or date? | Record the target version/date and the source of the commitment: (a) public roadmap URL — record URL and date accessed; (b) written statement under NDA — record document reference and date; (c) verbal only — record as "vendor-stated, no written artefact confirmed". Verbal-only commitments must be flagged as unconfirmed. |

## Evidence Checklist

The items below are a level-specific summary of the artefacts a vendor should be able to produce. They can serve as a concise request list for an assessor, or as a self-assessment reference for a vendor preparing evidence before a formal assessment. The detailed requirements and acceptance criteria for each item are in the assessment questions above.

- Release notes or changelog entry confirming availability of the quantum-safe feature.
- Documentation describing how to enable the feature for evaluation.
- A statement of the supported algorithm(s) and their specification reference (e.g., FIPS 203).

## Suggested Procurement Actions

- Obtain the release notes and configuration guide; perform a technical proof-of-concept.
- Assess the gap to Level 2 and negotiate a roadmap commitment.
- Include Level 2 attainment as a contract milestone or renewal condition where the product is on a critical path.

