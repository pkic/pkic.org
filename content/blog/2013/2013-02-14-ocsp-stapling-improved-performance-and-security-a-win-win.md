---
title: 'OCSP Stapling: Improved Performance and Security, a Win-Win'
authors: [Jeremy Rowley]
date: 2013-02-14T16:00:30+00:00
dsq_thread_id:
  - 1958557398


---
The launch of the CASC has given its members a unique platform through which we can educate users about online security and the best practices in utilizing SSL. That&rsquo;s why we&rsquo;ve decided to pair the group&rsquo;s launch with a focused effort on OCSP stapling.

Why OCSP stapling? For one, stapling is already supported by IIS and the newest versions of Apache and nginx. Although server software does not enable OCSP by default, servers can be re-configured with a little education. OCSP stapling is a significant improvement on traditional CRLs and OCSP revocation mechanisms because it eliminates the communication between the browser and CA when establishing the SSL connection. This leads to an increase in browsing performance and eliminates an attacker&rsquo;s ability to successfully block a CA&rsquo;s ability to provide revocation information. Stapled OCSP responses are cached by the web administrator and sent back to the relying party during the communication, effectively reducing bandwidth requirements and speeding up the SSL connection.

As a quick recap.  
Available through browsers and server systems? Check.  
Enhanced security? Check.  
Less bandwidth than traditional revocation services? Check.  
Faster connection speed and better site performance? Check.

What are we waiting for? Let&rsquo;s make it happen.

Look for more posts on this subject soon, including some tutorials on how web administrators can turn on OCSP stapling. For more information about this initiative, visit: <http://bit.ly/V01LhG>

Jeremy Rowley &ndash; Associate General Counsel, DigiCert