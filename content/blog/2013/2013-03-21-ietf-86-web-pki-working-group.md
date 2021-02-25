---
authors:
- Bruce Morton
date: "2013-03-21T19:07:22+00:00"
dsq_thread_id:
- 1957162553
keywords:
- pki
- crl
- ssl
- web pki
- https
- google
- policy
- ocsp
- tls
- ietf
- revocation
tags:
- PKI
- CRL
- SSL/TLS
- Web PKI
- Google
- Policy
- OCSP
- IETF
- Revocation
title: IETF 86 – Web PKI Working Group


---
At the [IETF 86 meeting in Orlando](https://www.ietf.org/meeting/86/index.html) last week, there was a working group meeting discussing the operations of the Web PKI. At the previous IETF 85 meeting a [birds-of-a-feather](http://ssl.entrust.net/blog/?p=1591) was held to discuss the purpose of having such a group. The result of the meeting was an established group with the [charter](https://datatracker.ietf.org/wg/wpkops/charter/) that states purposes such as:

  * Working group will work to improve the consistency of Web security behavior
  * Address problems as seen by the end-users, certificate holders and CAs
  * Describe how the Web PKI actually works
  * Prepare documented deliverables as discussed below

The meeting discussed the charter and the four following deliverables. More information is in the [presentation slides](https://datatracker.ietf.org/meeting/86/materials.html); look under the Operations and Management Area, then under WPKOPS.

## Trust Models

The trust model document will discuss how the root store providers support the trust between the end entities Web server and the relying party’s browser. The CAs play a trusted third party (TTP) in the model where they comply to the root store providers certificate policy, provide certificates to the end-entities and provide certificate status to the relying parties.

What makes the case interesting is that there are many parties in each role in the model. The trust model for the Web PKI has to consolidate certificate policies from many root store providers. The trust has to work for many servers and many browsers. There are many CAs globally providing TTP to the model.

The document will discuss the basic model and the variants for how the roles are adapted to the real world.

## Certificate Revocation

Certificate revocations will be reviewed to see what CAs issue, whether end-entities provide revocation data and how relying parties handle revocation.

Revocation data is provided by certificate revocation lists (CRL) and OCSP, including [OCSP stapling][1]. The distribution points for this data are included in the SSL certificate.

OCSP, as deployed, is also interesting. The group wants to know what trust anchors are accepted and what certificate extensions are set, such as key usage, extended key usage and policy OIDs.

## Field & Extension Processing

With many CAs issuing certificates and many browsers and Web servers using certificates, we all want to know what is in them and how are they handled. The problem is inconsistent behavior. From a support point of view, consistent behavior is less confusing and easier to maintain user satisfaction.

To develop the document, researches are using six different user agents installed on 30 operating systems to test 300 conditions. The goal will be to use cross-sourcing to find the broad areas of matches and mismatches, then perform specific testing to focus on the confusing areas. The data will be tabulated on spreadsheets through Google Drive and made freely available to interested parties.

The project is still at the beginning where the conditions list, platforms/OSs and user agents still need to be determined.

## TLS Stack Operation

There are common [PKIX](https://en.wikipedia.org/wiki/PKIX#Public-Key_Infrastructure_.28X.509.29_Working_Group) issues with the TLS stack, such as no chain to trust anchor, non-matching names, expired certificates and expired CA certificates.

The document will cover TLS protocol tweaks to common SSL libraries to achieve interoperability. It will address how alerts are provided to the relying party and the navigation bar use of long-lived icons and indicators. It will also discuss PKI-related choices made by the relying party.

## Moving Forward

Development of the documents will take about two years to complete. Once completed, the data will help industry standard groups and developers improve the use and security of PKI implementations. Hopefully, this will translate to a more pleasant and secure browsing experience.

Bruce Morton, Director, Entrust Certificate Services, Entrust

 [1]: https://casecurity.org/2013/02/14/certificate-revocation-and-ocsp-stapling/