---
authors:
- Bruce Morton
date: "2015-03-11T16:00:22+00:00"
dsq_thread_id:
- 3586675110
- General
keywords:
- ssl
- vulnerability
- microsoft
- attack
- forward secrecy
- encryption
- tls
- mitm
- android
- rsa
tags:
- SSL/TLS
- Vulnerability
- Microsoft
- Attack
- Forward Secrecy
- Encryption
- MITM
- Android
- RSA
title: Is Your SSL Server Vulnerable to a FREAK Attack?


---
FREAK is a new man-in-the-middle (MITM) vulnerability discovered by a [group of cryptographers at INRIA, Microsoft Research and IMDEA][1]. FREAK stands for “Factoring RSA-EXPORT Keys.”

The vulnerability dates back to the 1990s, when the US government banned selling crypto software overseas, unless it used export cipher suites which involved encryption keys no longer than 512-bits.

The issue is there are still some clients who let crypto be degraded from “strong RSA” to “export grade RSA”. These clients use [OpenSSL][2], Apple’s Secure Transport and [Windows Secure Channel][3]. As such, users of Android mobiles, Apple Macs, iPhones and iPads, and Windows platforms will be impacted.

There are two parts of the attack as the server must also accept “export grade RSA.” Studies have shown that of 14 million browser trusted websites, [36 per cent will drop down to 512 bits or below][4].

So how can an attack be implemented? First, the user on a vulnerable browser addresses a legitimate website where the browser asks for a standard RSA cipher suite. The communication is intercepted by a MITM and the MITM asks the legitimate website for “export grade RSA.” The MITM then completes the TLS handshake with the browser, but with the lower level of crypto.

Now the MITM can crack the small sized key. This attack can be done with a decent PC and about 2 weeks or about $100 using Amazon cloud and a few hours. With the key cracked, the MITM can decrypt the TLS master secret, then the session can be analyzed or changed.

The issue is aggravated as generating RSA keys is costly. As such, modern web servers do not change them for every single connection. In some cases, the key is used for the lifetime of the server. This means you don’t have to be that fast to break a key.

How bad is the FREAK vulnerability? Ivan Ristić states the following, “In practice, I don’t think this is a terribly big issue, but only because you have to have many “ducks in a row”: 1) find a vulnerable server that offers export cipher suites; 2) it should reuse a key for a long time; 3) break key; 4) find vulnerable client; 5) attack via MITM (easy to do on a local network or Wi-Fi; not so easy otherwise).”

Moving forward, Apple, Android and Microsoft will have to issue patches to correct their operating systems, browsers and devices. Unfortunately for Android users, Google does not patch the device, this is done by the carrier. As such, we don’t know if those users will be patched. Users can test their browsers at [SSL Browser Test][5].

Due to slow browser and operating system changes, the solution needs to be performed at the server end. Your server should disable support for any export suites. Administrators should be encouraged to disable all insecure ciphers and enable suites which support [perfect forward secrecy][6]. Mozilla has a guide with [recommended configurations][7].

Use the [SSL Server Test][8] to check your server.

{{< figure src="/uploads/2015/03/freak-graphic.jpg" >}}

 [1]: https://www.smacktls.com/
 [2]: https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2015-0204
 [3]: https://technet.microsoft.com/en-us/library/security/3046015.aspx
 [4]: https://freakattack.com/
 [5]: https://www.ssllabs.com/ssltest/viewMyClient.html
 [6]: https://casecurity.org/2014/04/11/perfect-forward-secrecy/
 [7]: https://wiki.mozilla.org/Security/Server_Side_TLS#Recommended_configurations
 [8]: https://www.ssllabs.com/ssltest/