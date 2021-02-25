---
authors:
- Kirk Hall
date: "2013-10-15T16:00:25+00:00"
dsq_thread_id:
- 1937611668
keywords:
- root program
- webtrust
- itu
- ca/browser forum
- iso
- cps
- qualified
- ssl
- https
- microsoft
- policy
- etsi
- aicpa
- casc
- extended validation
tags:
- Root Program
- WebTrust
- ITU
- CA/Browser Forum
- ISO
- Policy
- Qualified
- SSL/TLS
- Microsoft
- ETSI
- AICPA
- CASC
- EV
title: Certificate Authority Audits and Browser Root Program Requirements


---
Recent news stories have highlighted the need for strong security in online communications, and use of SSL certificates issued by a publicly trusted Certification Authority (CA) is perhaps the best way to achieve that. But why should the public trust SSL certificates issued from commercial CA roots, which are embedded as trust anchors in web browsers?

One answer is because of the multiple layers of standards and tough requirements that all commercial CAs must meet – and for which they are audited every year. These standards and requirements have increased from year to year over the past decade.

### Early Technical Standards

In the 1990s, CA were chiefly governed by applicable technical standards for interoperability established by such documents as RFC 1422, 2459, 2527 (which was included in Annex A of Draft ANSI X9.79), and 2560. Other standards documents such as the ISO/IEC 9594-8/ITU-T Recommendation X.509, “Information Technology – Open Systems Interconnection: The Directory: Authentication Framework” and the American Bar Association’s Digital Signature Guidelines: Legal Infrastructure for Certification Authorities and Electronic Commerce suggested a framework for compliance by CAs, including establishment of a detailed and public Certification Practice Statement (CPS) with security procedures the CA would be obliged to follow. See [http://www.americanbar.org/groups/science_technology/digital_signatures.html](http://www.americanbar.org/groups/science_technology/digital_signatures.html). But compliance with these rules was essentially voluntary by the CA because confirmation of compliance under the AICPA’s Type II SAS 70 Audit Report allowed CAs to define their own control objectives and so was considered too weak .

### WebTrust for CAs

All of that changed starting in 2000 with the introduction of WebTrust for CAs, a performance audit regime that lays out specific technical, security, and procedural steps that all CAs must follow. The audit must be completed each year, and a final audit letter indicating compliance is posted on each CA’s website. See WebTrust standards documents at [http://www.webtrust.org/homepage-documents/item27839.aspx](http://www.webtrust.org/homepage-documents/item27839.aspx).

WebTrust for CAs requires annual performance audits by an independent third party auditor (usually from one of the world’s major auditing firms) of a CA’s operations and practices in each of the following substantive areas:

  * Business practices disclosure
  * Business practices management
  * Environmental controls (especially security controls)
  * Key life cycle management controls
  * Subscriber key life cycle management controls
  * Certificate life cycle management controls
  * Subordinate CA certificate life cycle management controls

Successful CAs are permitted to display this WebTrust seal on their websites:

{{< figure src="/uploads/2013/10/webtrust-cert-auth.jpg" >}} 

### ETSI Policy Requirements for Certification Authorities Issuing Public Key Certificates

ETSI (the European Telecommunications Standards Institute) created parallel ETSI audit standards, which are used by some CAs (chiefly in Europe) instead of the various WebTrust audit standards. Originally there was only an ETSI Technical Standard (TS) for issuing qualified certificates under the European Electronic Signature Directive 1999/93/EC (TS 101 456). However, there are now ETSI Technical Standards comparable to WebTrust, such as TS 102 042: Policy requirements for certification authorities issuing public key certificates. As of this writing, these ETSI Technical Standards are progressing through the European Commission to become European Norms (EN) under EN 319 411. Instead of obtaining a WebTrust seal, successfully audited CAs are placed on a Trust Service List, see [http://eutsl.3xasecurity.com/tools/](http://eutsl.3xasecurity.com/tools/).

### Extended Validation and Baseline Requirements Under WebTrust and ETSI

In 2005 most major commercial CAs and browsers created the CA/Browser Forum (Forum) to study issues related to SSL implementation and to raise the bar for SSL standards. See [www.cabforum.org](http://www.cabforum.org/). In 2007 the Forum released standards and requirements defining a higher-security Extended Validation (EV) certificate with stronger customer authentication under the EV Guidelines. See [https://www.cabforum.org/documents.html](https://www.cabforum.org/documents.html). This, in turn, led to auditable WebTrust and ETSI criteria in 2007 for all CAs that issue EV certificates, so that most CAs had to successfully complete ___two___ sets audit criteria each year.

Successful CAs are either permitted to display an additional EV WebTrust seal on their websites (see figure below) or be listed as successfully completing an audit under ETSI TR 101 564 (Guidance on ETSI TS 102 042 for Issuing Extended Validation Certificates for Auditors and CSPs).

{{< figure src="/uploads/2013/10/webtrust-cert-auth-extended.jpg" >}} 

Finally, the Forum decided to create additional auditable standards that would apply to all publicly trusted SSL certificates issued by a CA, not just EV certificates, and to beef up system security requirements at the same time. This led to the new CA/Browser Forum Baseline Requirements (2012) and related Baseline Requirements for WebTrust and ETSI (2013). Commercial CAs now must meet at least _**three**_ sets of audit criteria covering their security, operations, and procedures each year.

### Browser Root Program Requirements

But who actually forces commercial CAs to successfully complete these three WebTrust / ETSI annual audits? The browsers and operating systems that accept and trust “roots” from CAs and include them in their software updates, such as Microsoft, Mozilla, Google, Apple, and Opera. CAs can only sell digital certificates to customers if their roots are accepted as trusted by the browsers and operating systems and included in their software, so the browsers are in a position to force all CAs to complete these annual audits.

For examples of browser root programs that all CAs must satisfy, see:

  * Microsoft: [http://social.technet.microsoft.com/wiki/contents/articles/3281.introduction-to-the-microsoft-root-certificate-program.aspx](http://social.technet.microsoft.com/wiki/contents/articles/3281.introduction-to-the-microsoft-root-certificate-program.aspx)
  * Mozilla: [http://www.mozilla.org/projects/security/certs/policy/](http://www.mozilla.org/projects/security/certs/policy/)
  * Google: [https://sites.google.com/a/chromium.org/dev/Home/chromium-security/root-ca-policy](https://sites.google.com/a/chromium.org/dev/Home/chromium-security/root-ca-policy)
  * Apple: [http://www.apple.com/certificateauthority/ca_program.html](http://www.apple.com/certificateauthority/ca_program.html)
  * Opera: [http://www.opera.com/docs/ca/](http://www.opera.com/docs/ca/)

Browsers require proof of annual WebTrust or ETSI audits, as well as compliance with all other program rules, and additional requirements are added by the browsers frequently as new security needs are identified. CAs that don’t comply can (and do) have their roots removed from the browser root stores, which is effectively a death sentence for the CA’s business (as its certificates will no longer be trusted by the public).

Diginotar is one example of a CA that went out of business, in large part because its root certificates were no longer trusted after browsers had removed them from trusted root stores in their browser software. See [http://en.wikipedia.org/wiki/DigiNotar](http://en.wikipedia.org/wiki/DigiNotar)

### Role of the CA Security Council (2013)

The SSL ecosystem is also being improved through another CA organization – the CA Security Council (CASC). In 2013, seven major CAs decided to do more to improve SSL practices on the Internet through their collective action, and they formed the CA Security Council (CASC) – see the list of founding members at <https://casecurity.org/meet-the-council/>. CASC has undertaken a number of education projects already, and will be announcing new initiatives on an ongoing basis.

### Summary: CA Standards and Regulations are Extensive and Ongoing

In summary, it would be fair to say that CAs today are subject to considerable common security standards and industry regulations, imposed on CAs by the CAs themselves and by the browsers and applications as a condition to being included in trusted root stores. The standards and regulations are effectively enforced through auditing in accordance with at least three sets of annual performance criteria conducted by independent third party auditors under WebTrust or ETSI.

The industry has been on a path of continuous self-improvement since 2000, and its work is continuing as the public’s reliance on this security technology continues to grow and become increasingly important.