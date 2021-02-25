---
authors:
- Ryan Hurst
date: "2013-10-08T16:00:21+00:00"
dsq_thread_id:
- 1938402928
keywords:
- crl
- ca/browser forum
- internet engineering task force
- ssl
- https
- identity
- encryption
- vulnerabilities
- revocation
tags:
- CRL
- CA/Browser Forum
- IETF
- SSL/TLS
- Identity
- Encryption
- Vulnerability
- Revocation
title: The (Soon to Be) Not-So Common Name


---
If you are reading this post you are probably already familiar with the use of digital certificates and SSL even if you may not be familiar with the history. Before exploring the history of SSL, let’s review at its core what a digital certificate actually is. Fundamentally, a digital certificate is the binding of entitlements and constraints to a key, in other words a digital certificate would dictate the following, “The holder of the private key associated with this certificate can rightfully use the name John Smith when signing emails.”

When originally conceived Digital Certificates were used to help bind subjects (people and resources) to their representations in directories. This is why a certificate’s Subject Name is structured as a Distinguished Name (DN), which allows a directory to uniquely identify a subject. When looking up an encryption key for a user in an enterprise directory this approach makes perfect sense; however, it does not work so well on the Internet where there is no global directory of users.

This brings us to SSL, introduced in the mid 1990s during a time where nearly every large enterprise was already deploying directories and Certificate Authorities as part of their identity management frameworks. During this time there was only one way to represent the concept of a certificate subject and that was through the use of the Common Name (CN) field, which resulted in the DNS name of a SSL server to be placed within the CN field. Although technically acceptable, the CN field was originally intended for a user’s actual name. 

After SSL was finalized and broadly accepted, the Internet Engineering Task Force (IEFT) released a profile for X.509 which introduced the concept of Subject Alternative Names (SANs) where names not associated with a directory could be placed. This created a problem because certificates were already standardized on using the Common Name field for names not associated with a directory.

This led to many challenges, first of all many servers (especially today) have multiple DNS names and applications that are designed to support only the common name field doesn’t work with a single certificate that has more than one DNS name. Users were able to address this in the short term by using a single certificate for each DNS name but it came at a high cost as users needed to use a single IP address for each domain name.

Another problem with the usage of this approach is that applications don’t know what type of value to expect in the Common Name field. Is the value a person’s name or is it a DNS name? This is a problem because often times there are rules that require you to validate a piece of data before using it and this is especially true for DNS names. Since 1999 (when RFC 2549 was standardized) we have been on a slow path to moving away from the use of Common Names for domain names to using Subject Alternative Names.

Fast forward to 2012, Stanford researchers published a paper titled “_The most dangerous code in the world: validating SSL Certificates in non-browser software_” which identified a bunch of applications that fail to do the most basic certificate validation tasks correctly and as a result are the source of a bunch of security vulnerabilities. The applications discussed in the paper gave users a false sense of security not out of malice but as a result of the lack of understanding of the technology and a big part of that is the complexity 18 years of technological evolution carries with it.

To address this, a number of things need to change but one of the most immediate changes is the definition of what constitutes a valid SSL Certificate. This is changing to make the rule-set a little simpler for the application developer and to rule out options that are no longer considered good practice.

We see this happening in a few ways. First the CA/Browser Forum has worked with browsers to define a set of baseline practices that all Certificates must meet; we are also seeing browsers doing sanity checks to ensure these practices are in-fact followed.

These baseline requirements mandate that Certificate Authorities always include at least one Subject Alternative Name in the SSL Certificate they issue, meaning that today an application doesn’t need to look in both the Common Name and the Subject Alternative Name they only need to check the latter.

Currently most Certificate Authorities include the first DNS Name from the Subject Alternative Name in the Common Name field but this is done primarily for legacy reasons and at some point in the future will stop. When it does certificates will be a little smaller and developers lives may be a little easier.

With that being said, it’s hard to estimate when the CN field will be completely removed from certificates, as even today new applications that are being developed are using the CN field vs. the SAN field, and if an application does not look at the SAN field, the application will likely not work in a large number of deployments. This is exacerbated through the use of shared hosting which is used even more frequently due to the IPv4 address exhaustion problem ([http://www.potaroo.net/tools/ipv4/index.html](http://www.potaroo.net/tools/ipv4/index.html)). Long story short, these applications already don’t work everywhere and are going to work less places soon.

### Resources

  * [Baseline Requirements](https://www.cabforum.org/Baseline_Requirements_V1_1_5.pdf)
  * [Internet X.509 Public Key Infrastructure Certificate and Certificate Revocation List (CRL) Profile](http://www.ietf.org/rfc/rfc5280.txt)
  * [Microsoft Security Advisory: Update for minimum certificate key length](http://support.microsoft.com/kb/2661254)