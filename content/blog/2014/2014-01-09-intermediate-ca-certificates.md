---
authors:
- Robin Alden
date: "2014-01-09T21:00:38+00:00"
dsq_thread_id:
- 2100801660
keywords:
- cps
- ssl
- google
- attack
- policy
- tls
- vulnerabilities
- mitm
- root program
- firefox
tags:
- Policy
- SSL/TLS
- Google
- Attack
- Vulnerability
- MITM
- Root Program
- Firefox
title: Intermediate CA Certificates and Their Potential For Misuse For Man-In-The-Middle Attacks
aliases:
- /2014/01/09/intermediate-ca-certificates/


---
We have seen recently that Google detected that publicly trusted TLS/(SSL) certificates had been created for Google domains without having been requested by Google themselves.

The existence of such certificates might usually be taken as an indication of misissuance by the issuing CA (i.e. a failure or mistake by the CA which allowed the issuance of an end-entity certificate otherwise than in accordance with their policy) or as an indication of compromise of the issuing CA.

In this case the problem was not quite either of those things but instead arose from the issuance of an unconstrained trusted intermediate CA certificate by one part of the French government to another part. Following on from that was the (probably inadvertent) misuse of that CA certificate to issue a further intermediate CA certificate which was used in a security appliance of some sort to terminate TLS connections within an enterprise probably for DLP (Data Loss Prevention).

It seems counter-intuitive that such things should even be possible and unthinkable that relying parties (i.e. everyone) could be put at risk by the existence of such intermediate CA certificates, so let’s take a moment to examine how and why these things exist and what safeguards are in place.

  1. What legitimate use could there be for an appliance that sits between end users and the websites or other internet resources they access and whose aim is to terminate the TLS connection for the purpose of reading the (otherwise encrypted) traffic between the user and the website?
    
    In the general case where the end user is on the public internet then there is no legitimate use for such an appliance – and of course the successful deployment of such an appliance would require the compromise of various other elements of internet infrastructure such as internet traffic routing, domain name resolution (or both) in addition to the availability of either an unconstrained trusted intermediate CA certificate or trusted and unrevoked end entity certificates (and their respective private keys) for each site or resource with whom otherwise secured traffic was to be intercepted.
    
    Nonetheless there is a legitimate market for such appliances when used in a closed (typically enterprise) environment. One example might be when providing an internet connection to a financial dealing-room where there is a regulatory requirement that the dealers should have all of their communications recorded and where the dealers using the network are aware of the recording and understand that they can have no expectation of privacy when using the dealing-room network. Even here it is important that any measures taken by the appliance present no risk at all to everyone outside the dealing-room, and in this case this should be achieved by having the appliance use certificates which are issued not from a publicly trusted CA but instead from a private CA which is trusted only within the environment of the dealing-room. This is achievable with a small level of effort for most closed or enterprise deployments to make the private CA ‘trusted’ within their own defined scope.

  2. Is there anything that prevents every would-be attacker from getting an unconstrained trusted intermediate CA certificate which they could use with one of these appliances?
    
    Yes!
    
    Publicly trusted root CAs may not issue an unconstrained intermediate CA certificate to be used in a security appliance because to do so violates the CA/B Forum’s baseline requirements (section 11.1.1) on the means of ensuring that a TLS/SSL certificate is never issued without confirmation from someone who owns or controls the domain name.
    
    There are other reasons that a root CA may consider issuing an unconstrained intermediate CA certificate to a third party but whatever the reason such a CA certificate may not be issued unless that third party is subjected to the same level of audit as would qualify the third party to be a root CA in their own right (section 17) and the root CA remains responsible (section 18.3) for the intermediate CA’s actions including their compliance with the baseline requirements.
    
    In addition to these prohibitions in the CA/B Forum’s baseline requirements which are included by reference into most major browsers’ root program’s policy, Mozilla (the producer of the FireFox browser) asked all root CAs in their program to add a statement to the CA’s CP/CPS committing that they will not issue a subordinate (aka intermediate) certificate that can be used for MITM or “traffic management” of domain names or IPs that the certificate holder does not legitimately own or control.
    
    The publicly trusted root CAs are all being audited to demonstrate their compliance with the CA/B Forum’s baseline requirements.

None of the members of the CA Security Council issue unconstrained intermediate CAs from trusted roots to enterprises (or anyone else!) for this purpose, and all CA Security Council members have been in compliance with the root program requirements since they were introduced.

### References

<https://community.qualys.com/blogs/laws-of-vulnerabilities/2013/12/09/internal-mitm-attack-in-french-government-agency>

<http://googleonlinesecurity.blogspot.co.uk/2013/12/further-improving-digital-certificate.html>

<http://en.wikipedia.org/wiki/Man-in-the-middle_attack>

[https://wiki.mozilla.org/CA:Communications#February\_17.2C\_2012][1]

 [1]: https://wiki.mozilla.org/CA:Communications#February_17.2C_2012
