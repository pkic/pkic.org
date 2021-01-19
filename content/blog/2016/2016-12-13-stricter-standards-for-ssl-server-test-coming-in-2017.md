---
title: Stricter Standards for SSL Server Test Coming in 2017
authors: [Bruce Morton]
date: 2016-12-13T16:32:08+00:00
dsq_thread_id:
  - 5377516116


---
This is a good time to offer a reminder that the CASC has a great tool for secure server testing, the [SSL Server Test][1]. The tool grades your server installation and reviews the: certificate, protocol support, key exchange and cipher strength for security against standards and known vulnerabilities.

{{< figure src="/uploads/2016/12/stricter-standards-image.jpg" >}} 

The grading tool also provides feedback on handshake simulations with various versions of browsers and operating systems. This lets the server administrator know which implementations are supported. The test also checks the server mitigation for known vulnerabilities such as: DROWN, BEAST, POODLE and Heartbleed.

As support for SSL/TLS evolves, the author of the [SSL Server Test][1] reviews and changes the grading system to make it stricter. The goal is to discourage administrators from supporting vulnerable items, and instead arm them with what they need to support the latest and greatest practices for server security.

In 2017, we will start to see the following changes:

  * **3DES:** With the Sweet32 vulnerability, support for 3DES with modern browsers will have the server score capped at C.
  * **Forward Secrecy:** Since Edward Snowden made his exposures, the industry has recommended forward secrecy to mitigate pervasive surveillance. Not supporting forward secrecy will have the server score capped at B.
  * **AEAD Suites:** Authenticated communication is highly recommend and AEAD will be the only suites supported by TLS 1.3. AEAD suites will be required to get an A+.
  * **TLS Fallback:** Since the vulnerability of POODLE, the browsers have changed to avoid protocol downgrade, as such TLS\_FALLBACK\_SCSV will not be required to receive an A+
  * **Weak Ciphers:** All ciphers weaker than 128 bits will result in an F score.
  * **RC4:** Servers supporting RC4 will have a C score cap.
  * **SHA-1:** Sites using a SHA-1 certificate will not be trusted and although not confirmed, expect that the server will receive an F score.

The [SSL Server Test][1] grading will be changed continually to help support better HTTPS security. Please take time to test your server on a regular basis to ensure your site is secure and your users are protected.

 [1]: https://casecurity.ssllabs.com/