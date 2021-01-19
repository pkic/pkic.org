---
title: Certificate Revocation and OCSP Stapling
authors: [CA Security Council]
date: 2013-02-14T13:00:20+00:00
dsq_thread_id:
  - 1938884807
categories:
  - Initiative
tags:
- OCSP
- CRL
- IETF
- Revocation

---
### Revocation

As a body of global CAs, the CA Security Council is committed to educating server administrators, end-users and other interested parties about SSL enhancements and best practices that can better protect everyone. An important initiative that can make a practical difference right now is addressing easily implemented improvements to certificate status services that handle revocation of invalid or expired certificates, specifically the implementation of OCSP stapling.

### What is certificate revocation?

Certificate revocation is an important component of assuring SSL does its job and protects internet users from having their information stolen during a man-in-the-middle attack. Currently, there are two primary methods by which this occurs: Certificate Revocation List (CRL) repositories and Online Certificate Status Protocol (OCSP) responders. Certificate Authorities (CAs) publish CRLs and sign OCSP responses on regular intervals, with CRL generally being a weekly list of certificates revoked during the previous seven days and OCSP being signed and sent as a response within a few hours of a certificate&rsquo;s revocation. When a user attempts to access a web server, the server will check the latest CRL associated with the issuing CA and also send an OCSP request for certificate status information. The server sends back a response of &ldquo;good,&rdquo; &ldquo;revoked,&rdquo; or &ldquo;unknown.&rdquo; The user&rsquo;s browser will then either make a secure connection for the user or, if the certificate is determined to be &ldquo;revoked,&rdquo; alert the user about the potential risk of continuing with the unencrypted session. 

With man-in-the-middle attacks, certificate revocation becomes increasingly important as the best protection available to users and web server administrators. All major web browsers enable some form of certificate revocation. 

### Why does it matter?

Certificate revocation protects web users from compromised certificates that, if not revoked, could otherwise be used to spoof the site the person was actually intending to visit in order to steal private information from the user. Revocation also protects website and web server owners by identifying fraudulent certificates and mitigating man-in-the-middle attacks that could occur if a hacker is able to hijack a domain. It further protects web owners against breaches of trust that could damage customer relations.

### Why do some browsers not deploy CRL or OCSP?

Typical concerns include latency and poor performance for web users, resulting in sometimes slower page load times. Also, some have argued that receiving revocation responses takes too long, because browsers are coded to fetch responses every seven days, effectively providing a weeklong-window in which an attacker could gain valuable information using an invalid certificate. Chrome has expressed concern about the inconsistencies in how their competitors handle revocation as a reason for no longer following CRL and OCSP protocols.

### What can be done to improve certificate revocation?

The CA Security Council believes strongly that certificate revocation provides the best method of protecting web users from a malicious certificate. That&rsquo;s why its members have joined together to encourage the promotion and adoption of OCSP stapling (defined in RFC 6066) as a practical initiative that can be easily implemented and that can have a widespread effect on protecting the internet for everyone, while enhancing the browsing experience. 

The CASC plans to educate affected parties in the coming months through blog posts, conference presentations, and other resources that will help people learn about OCSP stapling and make it easier for web server administrators to understand how to enable OCSP stapling on their servers. We also plan to encourage wider adoption of this critical technology among software vendors and browsers. 

### Why use OCSP stapling?

OCSP stapling is an enhancement to the standard OCSP protocol that delivers OCSP responses from the server with the certificate, eliminating the need for relying parties (web users) to check OCSP responses with the issuing CA. This has the effect of reducing bandwidth, improving perceived site performance, and increasing security for everyone involved in establishing the secure session.

### What is OCSP stapling?

OCSP stapling is defined in the Internet Engineering Task Force (IETF) RFC 6066. The term &ldquo;stapling&rdquo; is a popular term used to describe how the OCSP response is obtained by the web server. The web server caches the response from the CA that issued the certificate.&nbsp; When an SSL/TLS handshake is initiated, the response is returned by the web server to the client by attaching the cached OCSP response to the CertificateStatus message.&nbsp; To make use of OCSP stapling, a client must include the &ldquo;status_request&rdquo; extension with its SSL/TSL Client &ldquo;Hello&rdquo; message.

OCSP stapling presents several advantages including the following:

  * The relying party receives the status of the web server&rsquo;s certificate when it is needed (during the SSL/TLS handshake).
  * No additional HTTP connection needs to be set up with the issuing CA.
  * OCSP stapling provides added security by reducing the number of attack vectors.

This technology is sure to evolve as enhancements to the current standard become effective. Nonetheless, OCSP stapling, as currently constituted, addresses a number of important issues related to OCSP. CASC members strongly urge clients to support OCSP stapling.

### Is OCSP stapling widely available now?

Yes, all major CAs back it, and leading browsers and server operating systems support OCSP stapling within the latest releases of their software, though not by default. It only requires that web server administrators enable this function by configuring their web servers to deploy it.