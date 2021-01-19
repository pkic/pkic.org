---
title: Self-Signed Certificates Don’t Deliver Trust
authors: [Bruce Morton]
date: 2013-04-02T20:48:10+00:00
dsq_thread_id:
  - 1937101464


---
We&rsquo;ve heard the argument that website operators could just use [self-signed certificates](https://en.wikipedia.org/wiki/Self-signed_certificate). They are easy to issue and they are &ldquo;free.&rdquo; Before issuing self-signed certificates, it&rsquo;s a good idea to examine the trust and security model. You should also compare self-signed certificates to the publicly trusted certification authority (CA) model; and then make your own decision.

## Self-Signed Certificate Model

  * Owner says who they are
  * Owner issues on their own policy
  * Owner is responsible for quality
  * Owner may not follow industry guidelines
  * Owner may not provide certificate status
  * Compromised certificates may not be able to be revoked
  * Owner is not audited
  * Issuer of certificate may not be authorized by the domain owner
  * Certificates may not be renewed if there are no reminders
  * Self-signed certificate model does not provide trust and the browser provides a trust dialogue box to indicate such

{{< figure src="/uploads/2013/04/Certificate-Error-Navigation-Blocked.jpg" >}} 

## Publicly-Trusted CA-Signed Certificate Model

  * CA verifies the owner of the domain and the certificate applicant
  * CA operates to a policy in conformance with the requirements of the browser and operating system vendors. The requirements include the [CA/Browser Forum Baseline Requirements, Extended validation (EV) Guidelines](https://www.cabforum.org/documents.html) and recommendations from NIST.
  * CA provides quality to the certificate. Checks include compromised keys, minimum key size, ensuring hashing algorithms, maximum validity period and proper certificate extensions.
  * CA updates policy based on industry best practices
  * CA provides certificate status through CRL and OCSP
  * Compromised certificates can be revoked
  * CA is audited to certificate issuing criteria such as [WebTrust for CA, WebTrust for EV and SSL Baseline Requirements](http://www.webtrust.org/homepage-documents/item27839.aspx)
  * Certificate requesters for a Domain validated certificate are authorized by the owner of the domain. Requesters for Organization and Extended Validation certificates are authorized by a member of the organization specified in the certificate.
  * CAs provide multiple reminders to ensure the certificates are renewed before they expire. CAs may also provide certificate discovery tools to find certificates on your systems which may not have reminders.
  * Publicly trusted CA model is based on the CA being a trusted third party to the browser/OS vendor, the website certificate subscriber and the end-users of the website. The CA is obligated to meet the requirements of all three parties.

## So, when should you use a self-signed certificate?

When trust, security, service, quality and reliability are not your criteria.

Bruce Morton, Director, Entrust Certificate Services, Entrust