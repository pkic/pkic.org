---
title: 'The Importance of Revocation Checking Part 2: A Real World Example'
authors: [Wayne Thayer]
date: 2013-03-11T16:00:08+00:00
dsq_thread_id:
  - 1937734354


---
Just last week, a new security incident related to certificate revocation checking made headlines. It was discovered that a legitimate website was hosting a malicious Java application that installed malware on the computers of people who visited the site. This comes after recent updates that introduced Security Level settings in Java, and then raised the default from Medium to High. At the high level, users are shown a warning before any unsigned Java code is executed. Unfortunately, this recent incident exposed a method that allows an attacker to bypass the warning.

Java supports the use of code signing certificates issued by Certificate Authorities. When Java code is signed with one of these certificates, it includes identifying information about the publisher of the code and is referred to as a signed application. Because signed applications are considered to be safer, Java typically allows them to be run without issuing the warning described above. Unfortunately, there are times when a code signing certificate needs to be revoked. A typical example is when someone with access to the certificate’s private key leaves the company and should no longer be able to sign code using the company’s identity. When a code signing certificate is revoked, any application that’s signed after the revocation date should not be trusted. Just like SSL, this revocation information is published by CAs in the form of Certificate Revocation Lists (CRLs) or made available via an Online Certificate Status Protocol (OCSP) service.

By default, Java doesn’t check to determine if a certificate has been revoked. The certificate used in last week’s attack had indeed been revoked, but without revocation checking it didn’t matter &#8211; the attack could be carried out without warning to the user, resulting in malware being installed on their computer. If this isn’t a good example of the importance of revocation checking, then nothing is!

With only a little bit of effort, Java allows users to enable revocation checking and reduce this risk. Select the Advanced tab of the Java Control Panel (accessible from the Control Panel in Windows) and scroll down to the Security section. There you’ll find two settings that you should enable:

  * Check certificates for revocation using Certificate Revocation Lists (CRLs)
  * Enable online certificate validation checking

The second option enables revocation checking via OCSP.

{{< figure src="/uploads/2013/03/java-control-panel.jpg" >}} 

As an added level of protection, many of the most popular browsers let you increase the amount of revocation checking that they perform by default:

Internet Explorer – select Internet Options, select the Advanced tab, and scroll down to the Security section. Verify that “Check for server certificate revocation” is selected.

Firefox – select Options, select the Advanced tab, select the Encryption sub-tab, and click on the Validation button. Make sure that “Use the Online Certificate Status Protocol (OCSP) to confirm the current validity of certificates” is checked. For added protection, select “When an OCSP server connection fails, treat the certificate as invalid.”

Chrome – select Settings, click on “Show advanced settings…,” and scroll down to the “HTTPS/SSL” section. Select “Check for server certificate revocation.”

Safari on Mac OS X – open the Keychain Access utility. Select the “Keychain Access” -> “Preferences” menu item, then select Certificates. Set both the OCSP and CRL options to “Require if certificate indicates.” Note that you may have to hold down the Option key on the keyboard when clicking on the drop-down list. Set the Priority to “OCSP.”

Wayne Thayer, CTO, Go Daddy