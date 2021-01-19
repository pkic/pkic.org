---
title: Why Is Certificate Expiration Necessary?
authors: [Bruce Morton]
date: 2016-10-19T16:26:21+00:00
dsq_thread_id:
  - 5236047018


---
## _The Long Life Certificate &#8211; Why It Doesn’t Exist_

Why is certificate expiration even necessary? Wouldn’t it be better if I could just buy a certificate with a long life before expiration? It would really simplify certificate management if it could be installed and forgotten. Simple, no management required, just file-and-forget.

Imagine, I’ve been in business, starting say 10 to 15 years ago. I roll out my web pages and secure them with a 20-year-validity SSL certificate. I do this by creating a 512-bit RSA key securely stored in the server’s key store. Hey! No, I’ll be more secure and create a 1024-bit RSA key. I’ll send the certificate request to the Certification Authority (CA) and they will issue the certificate directly from their root, signing and hashing it with RSA-MD5. Presto, security for life – well 20 years of life, right?

Well, what if I decide to renew the certificate today. Sorry, the CA won’t renew the certificate for 20 years, only 39 months maximum. Why is that?

Let’s answer that question later. First, let’s get the certificate. I create a new 1024-bit key pair and submit my certificate request. Oops, rejected. Why? The key is too small, so let’s upgrade to 2048-bit. I get my new certificate, but an intermediate CA certificate is also included. What’s this? Oh, certificates are no longer issued directly from the root. No problem, I install the certificate, but it doesn’t work. Why? Hashing algorithm is wrong. I mean, my server supports MD5 and SHA-1, what’s SHA-256?

So after 10-15 years have passed, the minimum key size is 2048-bit RSA, the certificates must be issued from an intermediate CA, and the hashing algorithm is SHA-256.

Getting back to the question – certificate expiration helps mitigate vulnerabilities caused by:

  * Evolving security standards
  * Changing ownership and control of companies and domain names

A certificate cryptographically ties your server keys to an identity. The identity is primarily your domain name, but can be increased by also including your organization name and address. In fact, the identity can jump up to the extended validation (EV) standard and include business category, registration date, entity number, and jurisdiction of formation or existence.

The big word is ‘cryptographically’ and this protection can decrease over time, primarily due to Moore’s Law, which assumes “the number of transistors in a dense integrated circuit doubles approximately every two years.” This translates to computers doubling in speed every two years. So, without any other attack techniques, brute force cryptographic attacks just get faster and faster. To mitigate cryptographic and other attacks, the SSL/TLS industry is required to increase key lengths and use new algorithms, protocols and practices and deprecate and remove known weaknesses.

There are several changes taking place through 2016 to increase protection, namely: the minimum RSA key size increased to 2048-bit, ECC key sizes are supported, the MD5 hash algorithm was eliminated, and the process to deprecate SHA-1 is underway.

Practices are also changing. Although it has never been a good practice, in the past, many certificates were issued directly from the root. This meant that the root had to be online, connected indirectly to the Internet. If the root key gets compromised, a whole public key hierarchy fails. Issuing from an intermediate CA allows the root to be offline yet capable of revoking intermediate CAs in case they are compromised. CAs used to only provide certificate status through CRLs, which could be quite cumbersome for downloads as their sizes grew. This practice has also changed. The new method requires that all CAs use OCSP providing a small response for each certificate status requested. So OCSP is another reason to update the certificate, to add the location of the OCSP response.

And, what about the control of companies and domains? Over time, there are mergers, acquisitions and name changes. In fact, many small companies never live beyond one year. Certificates with long lifecycles could be misleading when identity or domain control changes.

To help ensure that all certificates are using the latest security standards and in fact controlled by the current certificate owner, we expire them. New certificates are issued using the latest security standards, processes and a re-confirmation of domain control and organization identity. Shorter life certificates also promote the creation of new keys. Frequent key changes help mitigate compromises associated with them. The CA/Browser Forum has helped to promote certificate security by providing a maximum validity period of 27-months for EV certificates and 39-months for OV and DV certificates.

When you request a certificate, select a validity period that meets your security policy and count on your reliable CA to provide expiration notices to help you to avoid security lapses. Partnering with a CA maximizes security and minimizes administrative tasks associated with certificate management, bringing you close to a file-and-forget experience throughout the certificate lifecycle.

&nbsp;