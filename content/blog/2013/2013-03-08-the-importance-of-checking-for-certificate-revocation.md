---
title: The Importance of Checking for Certificate Revocation
authors: [Rick Andrews]
date: 2013-03-09T03:50:21+00:00
dsq_thread_id:
  - 1967257322


---
Certificates are typically valid for one to three years, and during that time it&#8217;s possible that the web site owner or the CA realizes that end users should not trust the certificate. There are several cases in which this might happen, including these:

  * The web site owner ceases doing business, no longer owns the domain name used in the certificate, has changed their organization name, or wishes to shut down the web server.
  * The subscriber learns that an unauthorized party has gained access to the private key associated with the public key in the certificate.
  * The CA learns that errors were made in authentication, the subscriber misrepresented some material info used in the authentication process, or the subscriber has violated the terms of its agreement with the CA.

When the subscriber or CA makes the decision to revoke a certificate, that decision must be conveyed to end users who encounter the certificate in use. There are two different methods for this:

  * CRL (Certificate Revocation List) – a digitally-signed file containing a list of certificates that have been revoked and have not yet expired. Even though there&#8217;s a separate CRL for each issuing CA certificate, a CRL can be fairly large. That makes them inefficient for use in devices with limited memory, like smart phones. However, if you visit a number of sites with certificates signed by the same issuing CA, retrieving the CRL and caching it might be a very efficient way to check the status of all those certificates.
  * OCSP (Online Certificate Status Protocol) – a protocol in which the client requests the status for a particular certificate signed by a particular issuer, and receives a digitally-signed response containing its status. Generally, an OCSP response contains one of three values: good, revoked, or unknown. OCSP responses are very small compared to many CRLs and are thus efficient for devices with limited memory.

Certificates should contain one or more URLs from which the end user can retrieve the CRL or OCSP response. If both methods are supported, the end user software (browser) will favor one over the other, but may fall back to the second method if the first one fails.

Generally, CRLs and OCSP responses are retrieved from web sites run by the CA itself. However, a new method of certificate status delivery is becoming popular – OCSP Stapling. With Stapling, the web site prefetches its own OCSP response from the CA and then delivers it to end users during the SSL handshake. This method is efficient because the end user doesn’t have to make a separate connection to the CA, and it&#8217;s safe because the OCSP response is digitally signed so it cannot be modified without detection.

Browsers and other apps will generally warn the user about certificate revocation and prevent them from proceeding. If the end user were allowed to visit a site with a revoked certificate, it&rsquo;s possible that he or she would not be communicating with the intended site, but instead with a malicious man-in-the-middle (MITM). Or the end user might be communicating with the intended site, but the CA has determined that the site should no longer be trusted. Proceeding to the site might expose the end user to a number of risks, including:

  * Loss of private information – An attacker might be able to view sensitive private information that the user sends to the web site. Some web sites collect information such as social security numbers, bank account information, credit card numbers, dates of birth, etc. If the end user sends this information to a web site with a revoked certificate, all could be captured by an attacker.
  * Identity theft – An attacker might be able to capture identity information (username, password) that the user sends to the web site. Knowing that information allows an attacker to impersonate the user on the legitimate web site. The attacker might also change a user&#8217;s password to hijack the user&#8217;s account.
  * Financial loss – Once the user&#8217;s identity is stolen, online resources &#8211; such as money in a bank account &#8211; can be stolen as well.
  * Installation of malware on their computer – In many cases, attackers are interested in installing malware on the user&#8217;s computer. Running such malware could allow the attacker to steal more private information from the user, watch what the user types and what web sites are visited, or take over the user&#8217;s computer for use in a larger attack. Malware can be spread further by accessing the user&#8217;s address book and sending email to every contact within it.

Rick Andrews, Technical Director, Symantec