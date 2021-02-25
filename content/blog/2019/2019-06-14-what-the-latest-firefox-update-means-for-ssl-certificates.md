---
authors:
- Tim Callan
date: "2019-06-14T18:13:34+00:00"
keywords:
- tls
- casc
- vulnerabilities
- extended validation
- firefox
- ssl
tags:
- SSL/TLS
- CASC
- Vulnerability
- EV
- Firefox
title: What the Latest Firefox Update Means for SSL Certificates


---
Last month marked the release of Firefox 66, the newest iteration of the ever-popular web browser.  The update adds a number of interesting new features, including improvements to content loading and extension storage, auto-play sound blocking, and support for the AV1 codec (on the Windows version at least).  The search feature has also been improved, and, as is typical of browser updates, a number of known security vulnerabilities have been patched.

The update also made improvements to the way in which security warnings are displayed in the browser, with the intention of helping users understand potential risks.  In the past, an SSL (aka TLS) certificate issue with the page would simply prompt a display alerting the user that the connection is not secure.  With this new update, the warning page will now inform the user that the page poses a potential security risk and include suggestions for what steps to take.

Mozilla posted a [blog][1] explaining the changes, citing the previous messages as “some vague, technical jargon nestled within a dated design.”  Whereas the old alerts flashed an inscrutable error code and noted an “invalid security certificate,” the new error pages specifically state that someone may be trying to impersonate the site that the user is attempting to visit, and that this party may be doing so in an attempt to steal information such as passwords, emails, or credit card details.  It also specifically states that the issue is most likely with the website itself, letting users know there is nothing they can do to solve this problem but putting their minds at ease that, at the very least, there is nothing wrong with their own computers or browsers.

{{< figure src="/uploads/2019/06/latest-ff-update-means-ssl-certificates.png" title="SSL Certificate Warning in Firefox 66" >}}

This is a welcome change.  While industry insiders are keenly aware of the role website certificates provide in safeguarding businesses and their customers, the truth is that public perception lags behind.  Research show that users generally associate the company-branded “green” address bar representing an Extended Validation (EV) SSL certificate with safety and security, but most lack a thorough grasp of exactly what that green address bar – or its absence – actually means.  The importance of a major web browser like Firefox stepping in to assist with that education should not be underestimated.

Firefox tells us that the [change has already seen results][1].  The developers conducted a quantitative survey that revealed a 22-55 percent decrease in the number of users who said they would ignore the warning message and a 29-60 percent decrease in the number who said they would use a different browser to access the web page.  Although web certificates themselves are browser agnostic, this research demonstrates that providing users with more information helps convince them to take these warnings seriously and reinforces the role SSL certificates play in user security.

Our mission at CASC is to make the web safer and more secure.  Web certificates help verify that the site you’re visiting is the site it claims to be, letting you know that it is safe to proceed.  Firefox reports that certificate error messages are common, with three percent of users seeing them on a daily basis – so helping users understand what they mean is important.  Educating users is a win-win scenario for all parties.  CAs provide sites with certificates validating their identities; Firefox displays those certificates and helps users understand what they mean, and users gain a more complete understanding of the potential security hazards they face online.

 [1]: https://blog.mozilla.org/ux/2019/03/designing-better-security-warnings/