---
date: 2026-05-07T00:00:00Z
linkTitle: "2 — Basic"
title: "Level 2 (Basic) - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: A product at Level 2 has quantum-safe algorithms supported in core functionality and is production-ready, with demonstrated compatibility with relevant standards.
summary: Level 2 means PQC is production-ready and standards-compliant. This is the minimum threshold for new production deployments.

weight: 30
sectionNav: true
---

## What Level 2 Means

A product at **Level 2** has moved beyond evaluation and into production. Quantum-safe algorithms are supported in the product's core functionality, are stable, and conform to recognised standards. Organizations can deploy quantum-safe configurations with reasonable confidence.

This level is the **minimum acceptable baseline** for new production deployments where long-term data confidentiality or integrity matters — particularly for systems with a service life extending beyond the anticipated availability of cryptographically relevant quantum computers.

> Level 2 is the **production floor**. Any new procurement for a system with a long lifespan should require at minimum Level 2 from the vendor.
{.callout-info}

## Criteria

{{< criteria >}}
A product meets Level 2 when all Level 1 criteria are met, plus:

- Quantum-safe algorithms are supported in the product's **core production functionality** — not only in a beta or preview channel.
- The implementation demonstrates **compatibility with at least one relevant standard** (e.g., FIPS 203/ML-KEM, FIPS 204/ML-DSA, FIPS 205/SLH-DSA, IETF hybrid KEMs, or equivalent ETSI/ISO standards).
- The quantum-safe feature is **documented for production use**, including any known limitations or configuration requirements.
{{< /criteria >}}

Level 2 does **not** require full cryptographic inventory, crypto agility, or the feature to be enabled by default.

## Assessment Questions

At Level 2, generic claims are not sufficient — the assessor must verify specific algorithm names, parameter sets, standards references, and production documentation. At least one claim must be verified through an independent public source (e.g., NIST CMVP database) or a reproducible hands-on test. **A complete Level 2 assessment must also work through all [Level 1 questions](/wg/pqc/pqcmm/levels/1-initial/#assessment-questions).**

### Assessment methodology record

The assessment report must record:

- **Evidence method** — documentation review, CMVP/CAVP database verification, interoperability testing, hands-on configuration, or a combination.
- **Cryptographic library** — library name and exact version; whether the library version's PQC support was independently confirmed from a public source; whether the library is currently maintained.
- **Public database checks** — for each (NIST CMVP, NIST CAVP): URL accessed and date.
- **Hands-on tests** — for each: product version, environment (vendor sandbox / own installation / lab), test performed, and outcome.
- **Documents reviewed** — for each: URL, product version covered, and date accessed.
- **Unverified claims** — flag each explicitly as *"vendor-stated, not independently verified"*.

> Standards conformance claims must not be accepted on the vendor's word alone — use public databases wherever available.
{.callout-info}

### Production Availability

| # | Question | Assessment guidance |
|---|---|---|
| 2.1 | Which quantum-safe algorithms are available in the stable/production release? Name the specific algorithms and parameter sets. | Record exact names (e.g., ML-KEM-768, ML-DSA-65 — not "ML-KEM" or "full PQC support"). Request the release notes URL for the production release that introduced or confirmed GA status. Confirm the URL covers the assessed product version. Record the product version, release notes URL, and date accessed. |
| 2.2 | In which product components or functional areas is each quantum-safe algorithm used in production? | Request a per-component breakdown and record each entry with: component name, algorithm, parameter set, and usage context — e.g., "ML-KEM-768 — TLS 1.3 key exchange — server-side". Blanket claims ("we use ML-KEM everywhere") must be decomposed into specific component entries before recording. |
| 2.3 | Does the product implement quantum-safe algorithms via a third-party cryptographic library, or through a custom in-house implementation? If a library is used, which library and exact version? | Most products rely on a well-known cryptographic library rather than writing cryptographic primitives from scratch. Common libraries include OpenSSL (with or without oqs-provider), wolfSSL, Bouncy Castle, AWS-LC, Microsoft CNG / BCryptPrimitives, NSS, mbedTLS, LibreSSL, Botan, and Crypto++. Record: **(a)** library name and exact version string as reported by the vendor; **(b)** the URL from the library's own official release notes or PQC documentation page confirming that the identified version supports the claimed quantum-safe algorithm in production (not only in a beta or preview build) — the assessor must verify this independently against the library's official sources; **(c)** whether the library version is currently maintained and eligible for security patches (record the library's support policy URL). If the vendor claims a custom in-house implementation, record the justification and apply heightened scrutiny to standards conformance questions. |
| 2.4 | Is the feature supported under the vendor's standard support and maintenance terms, including security patch coverage? | Request the support policy document or URL. Record the specific policy clause or page that confirms the quantum-safe feature is included in standard support. A verbal assurance without a written policy reference is recorded as "vendor-stated, not contractually confirmed". |
| 2.5 | Has the vendor declared this feature generally available (GA) in the product's stable release channel? | Record the release notes URL or changelog entry, the GA date, the product version, and the stable release channel identifier. The distinction between Level 1 and Level 2 is the **release channel**, not adoption: the feature must be present in a stable, generally available release available to all customers — not in a beta, preview, or experimental channel. A GA declaration without a dated, versioned written document reference is not independently verifiable. |

### Standards Compliance

| # | Question | Assessment guidance |
|---|---|---|
| 2.6 | Which standards does the quantum-safe implementation conform to? Provide the specific standard document reference and edition. | Record the exact standard designation and publication date — e.g., NIST FIPS 203 (ML-KEM, August 2024, https://csrc.nist.gov/publications/detail/fips/203/final). Conformance to a pre-standardisation draft (e.g., Kyber round 3 / CRYSTALS-Kyber) that predates the final FIPS publication does not count — check whether the implementation names are FIPS names (ML-KEM, ML-DSA, SLH-DSA) or draft names (Kyber, Dilithium, SPHINCS+). Record which is used. |
| 2.7 | Can the vendor provide proof of standards conformance — such as a NIST CMVP listing, conformance test results, or an interoperability test report? | Verify independently: search the NIST CMVP database (https://csrc.nist.gov/projects/cryptographic-module-validation-program) by product or library name. If the product uses a third-party cryptographic library (see question 2.3), search by that library name and version — the library's own certificate may cover the module boundary. Record: certificate number, module name, vendor, module version, validation date, approved algorithm list, and the certificate page URL. Confirm that (a) the module version matches the assessed product version or the library version in use, and (b) the quantum-safe algorithms appear in the approved algorithm list. A FIPS 140-2 certificate predating PQC standardisation does not cover quantum-safe algorithms — check the validation date against the FIPS 203/204/205 publication dates (August 2024). |
| 2.8 | Has the implementation been tested for interoperability with at least one other conformant implementation? Which implementation, which version, which protocol? | Record: the implementation tested against (name and version), the protocol (e.g., TLS 1.3 with ML-KEM-768 key exchange), the test suite used — e.g., NIST ACVTS (https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program) or OQS interop test harness (https://github.com/open-quantum-safe/oqs-interop-test) — and the test result (pass/fail). A self-reported interop claim without a named test suite and result is weaker evidence — flag it accordingly. |
| 2.9 | Are there known deviations from the referenced standard, and are these documented? | Record any documented deviation with the document reference (title, version, URL). If the vendor states there are none, record the date and source of that written statement. Deviations found by the assessor during independent testing that are not disclosed by the vendor are a disqualifying finding. |

### Documentation & Migration

| # | Question | Assessment guidance |
|---|---|---|
| 2.10 | Where is the production deployment documentation? Provide a URL or document reference covering configuration, key management, and upgrade paths. | Record the documentation URL and confirm it is accessible for the assessed product version. Check that it covers at minimum: (a) configuration steps with specific parameter names; (b) key management lifecycle (generation, storage, rotation); (c) upgrade / migration path for existing deployments. Record which of these three areas are and are not covered — partial documentation is itself a finding. |
| 2.11 | Are there documented migration paths from classical to quantum-safe configurations for existing deployments? Is the migration in-place or does it require re-key or re-enrolment? | Record the migration guide URL or document reference. Note explicitly: whether migration is in-place or requires re-key / re-enrolment, whether service continuity is maintained, and whether rollback is possible. A migration guide that requires full re-deployment without continuity guidance is a risk for production environments. |
| 2.12 | How does the vendor respond to a cryptographic vulnerability in a deployed quantum-safe algorithm? Has a security advisory process been published? | Record the security advisory page URL (e.g., vendor security page, CVE disclosure policy URL). If a prior advisory covering a cryptographic component exists (for any algorithm, not just PQC), note it — it is evidence the process is active. Absence of any defined disclosure process is a finding. |

## Evidence Checklist

The items below are a level-specific summary of the artefacts a vendor should be able to produce. They can serve as a concise request list for an assessor, or as a self-assessment reference for a vendor preparing evidence before a formal assessment. The detailed requirements and acceptance criteria for each item are in the assessment questions above. All artefacts from [Level 1](/wg/pqc/pqcmm/levels/1-initial/#evidence-checklist) remain required.

- GA release announcement or product changelog confirming production availability.
- Reference to the standard(s) the implementation conforms to.
- Configuration guide for enabling quantum-safe mode in a production environment.
- Interoperability test results or certificates, if available.

## Suggested Procurement Actions

- Require Level 2 as a minimum for any new production procurement on systems with a service life beyond 5–7 years.
- Verify standard conformance claims against publicly available test results.
- Evaluate the gap to Level 3 for systems where ongoing cryptographic visibility and agility are required.

