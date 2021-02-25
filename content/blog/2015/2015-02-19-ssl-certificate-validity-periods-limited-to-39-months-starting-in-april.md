---
authors:
- Jeremy Rowley
date: "2015-02-19T23:52:18+00:00"
dsq_thread_id:
- 3531096319
keywords:
- webtrust
- ca/browser forum
- ssl
- policy
- etsi
- vulnerabilities
tags:
- WebTrust
- CA/Browser Forum
- SSL/TLS
- Policy
- ETSI
- Vulnerability
title: SSL Certificate Validity Periods Limited to 39 Months Starting in April


---
<h3 style="margin-bottom: 10px;">
  __$1__
</h3>

In accordance with the [CA/Browser Forum Baseline Requirements][1], effective April 1, 2015, Certificate Authorities (CAs) will no longer be able to issue SSL Certificates with a validity period longer than 39 months.

Shortening the validity period to 39 months is the result of much consideration within the CA/Browser Forum to arrive at a duration that allows optimal usability while maintaining the tightest network security. A shortened validity period will significantly improve Internet security by requiring administrators to renew and verify their certificates more often. It will also make it easier for users to keep up-to-date on new advances in security and remain aware of their control over private keys.

Shorter validity periods ensure that when vulnerabilities become known, CAs can replace affected certificates in a timely manner, eliminating the need for a long cycle in improvements. Three years is long enough to avoid overly burdening administrators, but allows for updates that are regular enough to ensure best security practices.

The impact of this new policy has been greatly mitigated by the action of many CAs to limit or end the issuance of such certificates well in advance of the April 1, 2015 deadline. Organizations with certificates of longer validity than 39 months currently in deployment need to be aware of the rules changes so they are not caught off-guard when the time comes for them to reissue their certificates. For now, their existing certificates will be unaffected.

Starting April 1, CAs either will no longer reissue existing certificates with more than 39 months remaining or choose to truncate the validity period to comply with the new standard. Certificates with a validity period longer than 39 months may continue to be used after April 1, but any renewal of the certificate will be limited to the new maximum lifecycle.

## A New, Improved Future

Limiting certificate validity periods is one of many steps taken by CAs and browsers to improve network security minimum standards that are enforceable by independent WebTrust or ETSI audits. These audits, in addition to the current policies and requirements set forth by browser root stores, help protect organizations and users alike and raise the bar for everyone. Ongoing CA/Browser Forum working groups currently are reviewing other practice areas where minimum standards can be enhanced to provide tangible benefits for online security.

As an industry, we are committed to continual improvement to advance practices and address evolving threats. In accordance with this vision, we invite you to bookmark our blog so that you can stay up-to-date on the most recent industry standards that affect your digital certificate deployment.

_Note: This blog post was adapted from an original piece by Jeremy Rowley on the DigiCert blog._

 [1]: https://cabforum.org/wp-content/uploads/BRv1.2.3.pdf