---
authors:
- Bruce Morton
date: "2016-09-07T17:02:37+00:00"
dsq_thread_id:
- 5126635769
keywords:
- attack
- rc4
- encryption
- tls
- 3des
- ssh
- tls 1.0
- https
tags:
- Attack
- RC4
- Encryption
- SSL/TLS
- 3DES
- SSH
- TLS 1.0
title: How a SWEET32 Birthday Attack is Deployed and How to Prevent It


---
Details surrounding the [SWEET32: Birthday attacks on 64-bit block ciphers in TLS and OpenVPN][1] can be found in the paper released by Karthikeyan Bhargavan and Gaëtan Leurent from INRIA in France. The paper shows that cipher suites using 64-bit block length ciphers are vulnerable to plaintext recovery attacks. As such, Triple-DES (3DES) and Blowfish are vulnerable. Here’s an overview.

## Vulnerabilities to a SWEET32 Birthday Attack

Certain scenarios are pre-disposed to a SWEET32 Birthday attack. For HTTPS, most susceptible are websites that support the 3DES algorithm and sustain long lived connections.

Short block sizes such as 64-bits are vulnerable to birthday attacks. The birthday attack suggests that a brute force attack can be drastically reduced. Therefore, a collision attack against encryption using 64-bit ciphers can happen when around 2⁶⁴ᐟ² or 2³² bytes of encrypted cipher text are created. This would translate to 32 GB of data, which can easily be reached in practice.

Popular solutions that use block ciphers with 64-bit blocks include:

  * 3G telephony (UMTS), encrypted with KASUMI
  * OpenVPN, which uses Blowfish as the default cipher
  * Internet protocols, such as TLS, IPSec and SSH, which support 3DES as a legacy cipher

HTTPS is impacted as 3DES is a mandatory algorithm in TLS 1.0 and 1.1. As a consequence 3DES is implemented in most TLS libraries, deployed by approximately 86 per cent of web servers and supported by all popular browsers. OpenSSL supports 3DES, but due to the paper have reduced 3DES from high to medium in its security list.

For a TLS connect, the cipher negotiated is chosen by the server based on its cipher suite preference and the suites supported by the browser. Fortunately, AES is typically preferred over 3DES, but still 1.2 per cent of all TLS connections made with the Alexa 1 million websites will use the 3DES cipher suite.

In order to deploy a SWEET32 attack on HTTPS, a long lived TLS connection is required to send a large number of HTTPS requests in the same TLS connection. This is possible using a persistent HTTP connection defined in HTTP/1.1 as Keep-Alive. All browsers appear to support Keep-Alive. From the server side, Apache and Nginx limit the number of requests in the same connection with 100 set as the default; however IIS does not have a limitation. Follow on testing of the Alexa top 10k showed that 0.6 per cent of HTTPS connections were vulnerable to SWEET32.

## Preventing a SWEET32 Birthday Attack

Websites that support 3DES are vulnerable to a SWEET32 Birthday attack.  Your server administrator should know whether your website supports 3DES, but it is easy to determine using [SSL Server Test][2] and check the cipher suites for 3DES.

Server administrators should consider the following to mitigate SWEET32:

  * Prefer minimum 128-bit cipher suites
  * Limit the length of TLS sessions with a 64-bit cipher, which could be done with TLS renegotiation or closing and starting a new connection
  * Disable cipher suites using 3DES

The researchers have stated that SWEET32 is comparable to the attacks on RC4. Hopefully this means that the browsers will also plan to mitigate the attack by supporting 3DES as a fallback-only cipher, even if the server prefers 3DES over AES.

Server administrators should always plan to be proactive. By following [SSL Labs best practices][3], you would have considered stopping support or giving less preference to 3DES back in 2013.

 [1]: https://sweet32.info/
 [2]: https://casecurity.ssllabs.com/
 [3]: https://www.ssllabs.com/projects/best-practices/index.html