---
title: 9 Common Myths About CAs
authors: [Tim Callan]
date: 2019-08-01T15:00:04+00:00


---
Over the years misconceptions about CAs and the SSL infrastructure have arisen. Below is a list of common myths related to SSL and CAs.

## Myth #1: CAs are not regulated

Fact: CAs are subject to various checks and balances, including third-party qualified audits through WebTrust or ETSI and strict criteria set forth by leading browsers, before they are accepted in browser root stores. Similarly, the CA/Browser Forum’s Baseline Requirements and Network Security Guidelines establish global standards for certificate issuance and CA controls that will soon be included in third-party auditing standards. Browsers are free to use these requirements to exclude non-compliant CAs from the root store.

## Myth #2: CAs do not provide value

Fact: For more than 20 years, CAs have played a key role as guardians of online trust by using rigorous methods to validate certificate requests from organizations before issuing digital certificates. Validation methods may include verifying domain ownership, business registration, authorization of applicants to request certificates on behalf of their organization, and other legal documents. CAs spend large amounts of capital working to secure their data centers and internal operations, train their staffs on best practices for certificate validation and issuance, and enforce industry controls using periodic vulnerability and penetration testing along with annual third-party audits. Self-signed certificates (those issued without any CA authentication) enable encryption to and from a website, but no assurance of the identity of the website.

## Myth #3: All types of certificates issued by CAs are the same

Fact: CAs issue various types of certificates to handle different purposes. Different types of certificates include SSL certificates that secure website transactions, code signing certificates that protect applications from tampering and malware, S/MIME certificates that authenticate e-mail exchanges, and client-authenticated certificates used within enterprise PKI settings.

CAs also offer SSL certificates with different types of validation. Depending on the certificate, a CA may verify the following:

  * Registration of the domain (DV) to the entity requesting a certificate.
  * That the organization is a registered legal entity and the person requesting the certificate is authorized to act on behalf of the organization (OV).
  * That the organization has a verified phone number, legitimate business address, and verified requester (EV).
  * Both EV and OV certificates include identifying information about the certificate holder in the organization field of the certificate.

## Myth #4: CAs are insular, unresponsive and unwilling to accept changes needed in the SSL protocol

Fact: This is a common misperception perpetuated by those who actively oppose CAs and advocate alternative models. Together, CASC members participate in dozens of industry standards-making bodies, educational groups, and research organizations, and they regularly assist in drafting proposals and adopting standards. CASC members actively work with browsers, relying parties and other stakeholders to enhance internet security through practical, thoughtful measures and collaborative research. Much of this dialog takes place in a public setting, such as CA/Browser Forum discussions.

## Myth #5: SSL is broken beyond repair and we must find a new replacement system for authenticating identities online

Fact: The SSL protocol has proven itself to be remarkably robust, and SSL certificates remain the world’s most reliable and scalable cryptography system. Reports of high-profile security incidents are attributed to the lack of proper internal security controls at the entity level rather than a system-wide failure. Members of the CASC are focused on tightening global standards to mitigate such incidences in the future. While no security solution is 100-percent fool-proof because of evolving threats, the best path forward is one that focuses on making practical, scalable enhancements to the current system instead of trying to replace publicly trusted CAs with unproven and limited technologies.

## Myth #6: SSL is an outdated system with too many vulnerabilities to work long-term

Fact: Having formed the backbone of internet security for more than 20 years, certificates from publicly trusted CAs remain the most proven, reliable and scalable method to protect internet transactions. CAs continue to work in collaboration with browsers and other parties to enhance the SSL protocol and enable additional functionality that will continue to meet evolving threats and protect all users.

## Myth #7: There are more than 600 CAs – too many to handle, and SSL is a commodity business

Fact: Although hundreds of intermediate certs may exist worldwide, [Mozilla’s root store][1] lists just 65 proprietary holders or trusted root certificates, and more than 99 percent of all SSL certificates issued originate from the root certificates of the world’s seven largest providers. Each of these leading companies is WebTrust-audited by an accredited third-party accounting firm and subject to standards passed by the CA/Browser Forum and other bodies. Each CA is accountable to both its customers and the browser root store operators. Because of the leadership of responsible CAs, the SSL industry has always stayed ahead of evolving threats. Recent examples of CA evolution include the deprecation of internal host names, deployment of SHA-2 and 2048-bit certs, and enhanced security guidelines. The CAs&#8217; ability to evolve is what will create a secure internet for many years to come.

## Myth #8: Certificate revocation is either unnecessary or broken. Its benefits do not outweigh the potential browser performance issues that it causes

Fact: Certificate revocation plays a key role in the SSL ecosystem as a leading authentication tool in determining whether a certificate should be trusted. Each day, billions of certificate status requests are sent to revocation response servers located around the world. These servers inform the browser about whether a certificate should no longer be valid. This protects users by ensuring browsers have the latest information on threats and problems worldwide. CASC members are working with browsers and other parties to further improve existing methods and develop new revocation systems that effectively balance performance and security and provide a trusted experience for all internet users.

## Myth #9: CAs have no incentive to innovate and make needed changes

Fact: CAs have the most incentive to enact needed changes and are working together to enhance the SSL system. A CA’s reputation is essential to its survival. Therefore, members of the CASC work very hard to evolve the industry and maintain an aggressive and effective security posture toward their own systems and those of the clients they serve. Recently adopted mandatory standards include the following (with others currently being debated):

  * Baseline Requirements
  * Network Security Guidelines
  * EV code signing and enhancements to EV SSL standards

 [1]: https://docs.google.com/spreadsheet/pub?key=0Ah-tHXMAwqU3dGx0cGFObG9QM192NFM4UWNBMlBaekE&single=true&gid=1&output=html