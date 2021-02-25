---
authors:
- Patrick Nohe
categories: null
date: "2020-07-09T18:43:06+00:00"
keywords:
- apple
- domain validation
- root program
- pki
- ca/browser forum
- sha2
- ssl
- identity
- sha1
- google
- microsoft
- policy
- tls
summary: Starting on September 1st, SSL/TLS certificates cannot be issued for longer
  than 13 months (397 days). This change was first announced by Apple at the CA/Browser
  Forum Spring Face-to-Face event in Bratislava back in March.
tags:
- Apple
- DV
- Root Program
- PKI
- CA/Browser Forum
- SHA2
- SSL/TLS
- Identity
- SHA1
- Google
- Microsoft
- Policy
title: One Year Certs


---
## Maximum SSL/TLS Certificate Validity is Now One Year

Starting on September 1st, SSL/TLS certificates cannot be issued for longer than 13 months (397 days). This change was first announced by Apple at the CA/Browser Forum Spring Face-to-Face event in Bratislava back in March.

Then last week, at the CA/B Forum’s Summer event (held virtually), Google announced its intention to match Apple’s changes with its own root program.

There is also a browser-driven ballot that seeks to align the industry’s baseline requirements with the new root program changes. That issue is currently being debated by the Forum.

## The reason for shorter SSL/TLS certificate lifespans

From a high-level, theoretical standpoint there are two primary benefits for shorter-lived certificates:

The first is the technical component – longer lifespans means it takes longer to organically roll out updates or changes. A real-world example would be the SHA1-to-SHA2 transition. Unless you’re going to revoke a whole bunch of certificates and force the customer to re-issue, it can take years before all of the old certificates are replaced. In the case of SHA1, it took three. That creates risk.

The other benefit has to do with identity – how long should the information used to validate an identity stay trusted? The longer between validation, the greater the risk. Google has said that in an ideal world domain validation would occur about every six hours.

Before 2015 you could get an SSL/TLS certificate issued for up to five years. That was reduced to three, and then again in 2018 to two. At the end of 2019, a ballot was proposed at the CA/B Forum that would have reduced it to one year – it was voted down soundly by the Certificate Authorities.

## So, why are certificate still being reduced to one year?

The CA/Browser forum is an industry group that meets to vote on a set of baseline requirements for the issuance of trusted digital certificates. What it is not, however, is a governing body. Even though the CAs expressed concerns and reluctance to decrease max validity again, Apple and Google are well within their right to update the policies for their root programs as they see fit.

Certificate Authorities and browsers have an interdependent relationship. Browsers need to use certificates to make trust determinations about websites and for help securing connections. On the CA side, what good is a public certificate if it’s not trusted by a browser?

The way this is all managed is through the root programs. There are four major root programs of note are Microsoft, Apple, Mozilla and Google.

Incidentally, you’ll notice those four are also behind the major browsers on both desktop and mobile. In order for a CA to have its certificates trusted by the root programs, and by extension the browsers and OSs that make use of them, it must adhere to that root program’s guidelines. The CA/B Forum is an industry forum that ideally helps to facilitate changes to the root programs (and the ecosystem itself).

But the root programs, which participate as browsers, can still act unilaterally and make changes as they see fit. When this happens, the need for interoperability basically dictates that whatever root program policy has the most stringent standards becomes the new de facto baseline requirement.

That’s how we got here. Now let’s talk about what this means for your website.

## What shorter SSL/TLS validity means for website owners

This goes into effect September 1, 2020. So, if you’re using a two-year certificate that was issued before September 1, your certificate will stay valid until its original expiration date. You just won’t be able to renew for two years moving forward.

Or to put it another way, you have until the first of September to get two-year certs. After that they will be relegated to the desktop recycling bin of history.

From a bigger-picture standpoint, this might be a good time to start giving consideration to automating more of your certificate lifecycle management functions. Especially for larger organizations managing dozens of publicly-trusted website certificates, but also for organizations using publicly-trusted email certificates, as well as any organization leveraging a private CA or PKI-based electronic signatures. You might also consider moving some certificates from public to private trust, which also helps with management – you could even issue certs with longer validity using that method.

Otherwise, the way things are headed with the root programs continuing to push for shorter validity – organizations are pretty much going to be forced to automate a lot of these things at some point in the future.