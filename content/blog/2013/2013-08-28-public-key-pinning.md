---
title: Public Key Pinning
authors: [Bruce Morton]
date: 2013-08-28T16:29:19+00:00
dsq_thread_id:
  - 1937101463
tags:
- IETF

---
The current browser-certification authority (CA) trust model allows a website owner to obtain its SSL certificate from any one of a number of CAs. That flexibility also means that a certificate mis-issued by a CA other than the authorized CA chosen by the website owner, would also be accepted as trustworthy by browsers.

This problem was displayed most dramatically by the [DigiNotar][1] attack in 2011 and in a mistaken CA certificate issued by [TURKTRUST][2] in 2012. In these cases, certificates were issued to domains that were not approved by the domain owner. Fortunately, the problem was detected in both cases by public key pinning, which Google implemented in Chrome.

So what is public key pinning? Public key pinning allows the website owner to make a statement that its SSL certificate must have one or more of the following:

  * A specified public key
  * Signed by a CA with this public key
  * Hierarchal-trust to a CA with this public key

If a certificate for the website owner&rsquo;s domain is issued by a CA that is not listed (i.e., not pinned), then a browser that supports public key pinning will provide a trust dialogue warning. Please note that website owners can pin multiple keys from multiple CAs if desired, and all will be treated as valid by the browsers.

The website owner trusts that its chosen, specified CAs will not mistakenly issue a certificate for the owner&rsquo;s domain. These CAs often restrict who can request the issuance of a certificate for the owner&rsquo;s specific domains, which provides additional security against mis-issuance of certificates to an unauthorized party.

Unfortunately, the public key pinning that Google implemented in 2011 is not scalable as it requires the public keys for each domain to be added to the browser.

A new, scalable public key pinning solution is being documented through a [proposed IETF RFC][3]. In this proposal, the public key pins will be defined through an HTTP header from the server to the browser. The header options may contain a SHA-1 and/or SHA-256 key algorithm, maximum age of pin, whether it supports subdomains, the URI to report errors, and the strictness of the pinning.

An example of a pin would look as follows:

```yaml
Public-Key-Pins: pin-sha1=”4n972HfV354KP560yw4uqe/baXc=”;
  pin-sha1=”qvTGHdzF6KLavt4PO0gs2a6pQ00=”;
  pin-sha256=”LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=”;
  max-age=10000; includeSubDomains
```

Implementing public key pinning will require website owners to make some critical early decisions, such as to how many keys to pin, whether to pin keys for subdomains and what to select as the maximum age of the pin.

The number of keys to pin and the maximum age of the pin will address the issue of acceptability of your website to browsers. Adding more keys to pin will useful, if your key may change due to changes at your CA or in the event of migration from one CA to another. The maximum age means the pin expires after a maximum number of seconds. By limiting the maximum age, any mistake in the pin will expire over a period of time. The proposed RFC indicates that 60 days would be a good maximum age of the pin.

Website owners who use pinning will also have to keep their pinning records up to date to avoid warning messages for replacement certificates the use are supported by a key which is not pinned. The benefit of potential warnings to the public for non-authorized certificates may justify this extra effort.

Pinning is also being looked at by [Microsoft for the Enhanced Mitigation Experience Toolkit (EMET)][4] and by the [Android project for Android 4.2][5]. We will see if other applications will also use pinning.

 [1]: https://en.wikipedia.org/wiki/DigiNotar#Issuance_of_fraudulent_certificates
 [2]: http://turktrust.com.tr/en/kamuoyu-aciklamasi-en.html
 [3]: https://tools.ietf.org/html/draft-ietf-websec-key-pinning
 [4]: http://blogs.technet.com/b/srd/archive/2013/04/18/introducing-emet-v4-beta.aspx?Redirected=true
 [5]: http://nelenkov.blogspot.ca/2012/12/certificate-pinning-in-android-42.html