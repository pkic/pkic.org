---
authors:
- Paul Walsh
date: "2019-10-10T15:52:09+00:00"
lastmod: "2019-10-16T15:52:09+00:00"
keywords:
- chrome
- ssl
- identity
- https
- google
- microsoft
- phishing
- attack
- policy
- encryption
- w3c
- vulnerabilities
- ev certificate
- extended validation
- revocation
- android
- dv certificate
- mozilla
- domain validation
- 2fa
- malware
- firefox
tags:
- Chrome
- SSL/TLS
- Identity
- Google
- Microsoft
- Phishing
- Attack
- Policy
- Encryption
- W3C
- Vulnerability
- EV
- Revocation
- Android
- DV
- Mozilla
- 2FA
- Malware
- Firefox
title: The Insecure Elephant in the Room


---
{{< figure src="/uploads/2019/10/insecure-elephant-1.png" >}}

## The purpose of this article

The purpose of this article is to demonstrate why I believe browser-based UI for website identity can make the web safer for everyone. I explain in great detail, the reasons why the UI and UX didn’t work in the past. And what’s left is only making the problem worse instead of better.

Some people seem to find it difficult to consume my thoughts about the enforcement of “HTTPS EVERYWHERE”, free DV certs and the browser padlock. Please assume that I support all of these things. My article covers controversial opinions about the undesirable impact that these things have had in the past, and have today. 

Some people even questioned my motives. It might help to read my bio at the end before reading the article – you will then be less likely to assume I’m biased. 

I have used a lot of data from which to draw my conclusions. If you disagree with my conclusions and decide to take the debate to Twitter as some people have already, please try to reference what you disagree with and why. 

Using the web is like playing a game of Russian roulette these days — both require luck. When a dangerous link slips through security, most users must rely on their intuition when it comes to trusting the website on the other end. And they must rely on luck to get it right.

Over 90% of data breaches start with a social engineering technique called “Phishing” — a method used by cybercriminals for stealing personal information using deceptive websites. According to Proofpoint, 99% of email threats require human interaction to execute and dangerous links outnumber malicious attachments five to one. This data paints a bleak picture — users’ intuition isn’t great, and luck isn’t always on their side.

## Cybersecurity today

Cybercriminals are aggressively targeting people instead of computer networks because sending fraudulent emails and stealing credentials with deceptive websites is easier, less expensive, and far more profitable than trying to take advantage of exploits and vulnerabilities.

Web domain fraud is a growing risk for businesses, government agencies and Internet users everywhere. Every year, threat actors register millions of domains to impersonate brands and defraud those who mistakenly trust that a site is legitimate.

Unfortunately, it’s technically impossible for any security solution to protect people from every deceptive website. And as I’m going to demonstrate with data, it’s virtually impossible for humans to differentiate between legitimate websites and deceptive websites.

The data suggests that phishing is the single biggest reason we read about data breaches, online identity theft, ransomware and malware attacks every day of the week.

I will also explain how ironically, websites that start with HTTPS are a big part of the problem. I will dive into why this is all happening, followed by a proposed solution.

### Data

I found some of this data thanks to the Dashlane blog.

  1. According to [Wombat Security State of the Phish](https://info.wombatsecurity.com/state-of-the-phish), 76% of businesses reported being a victim of a phishing attack in the last year.
  2. According to the [Verizon Data Breach Investigations Report](http://www.verizonenterprise.com/verizon-insights-lab/dbir/2017/), 30% of phishing messages get opened by targeted users and 12% of those users click on the malicious attachment or link.
  3. According to the [SANS Institute](https://www.networkworld.com/article/2164139/network-security/how-to-blunt-spear-phishing-attacks.html), 95% of all attacks on enterprise networks are the result of successful spear phishing.
  4. Research by IBM reveals that 59% [of ransomware attacks](https://www.vadesecure.com/en/ransomware-attacks-2017/?utm_source=blog&utm_medium=blog-post&utm_campaign=contact-us&utm_content=ransomware-statistics-2017) originate with phishing emails and a remarkable 91% of all malware is delivered by email.
  5. According to [Proofpoint](https://www.proofpoint.com/us/resources/threat-reports/latest-quarterly-threat-research), in the first quarter of 2019, cyberattacks using dangerous links outnumbered those with malicious attachments by five to one.
  6. According to the Webroot Threat Report, nearly 1.5 million new phishing sites are created each month.
  7. $1.8m is the average cost of a phishing attack on a mid-sized company in the US — it’s slightly less in other countries around the world
  8. According to Deloitte, one-third of consumers said they would stop dealing with a business following a cyber-security breach, even if they do not suffer a material loss.
  9. According to Aviva, after your company is breached, 60% of your customers will think about moving and 30% actually do.

###  Below are the top data breaches of 2018 ranked by the number of people affected:

{{< figure src="/uploads/2019/10/insecure-elephant-2.png" >}} 

  1. **Phishing represents 93% of all data breaches**. [Source](https://enterprise.verizon.com/resources/reports/dbir/)
  2. Phishing attacks increased 250% in 2018. [Source](https://infosecurity-magazine.com/news/phishing-attacks-spiked-by-250-in-1-1/)
  3. 70% of all newly registered domains are malicious, suspicious or not safe for work. [Source](https://unit42.paloaltonetworks.com/newly-registered-domains-malicious-abuse-by-bad-actors/)
  4. New tools such as [Modlishka](https://www.zdnet.com/article/new-tool-automates-phishing-attacks-that-bypass-2fa/) now automate phishing attacks, making it virtually impossible for any security solution to detect them — bypassing 2FA. [Source](https://www.zdnet.com/article/new-tool-automates-phishing-attacks-that-bypass-2fa/)

## Say goodbye to online brand protection

It has been in the works for some time, but it has finally happened. On September 10th 2019, Google removed the visual indicator for website identity in Chrome. Mozilla has scheduled the removal of their website identity UI for Firefox on October 22nd 2019. I’ll explain below, the severe implications caused by this move.

{{< figure src="/uploads/2019/10/insecure-elephant-3.png" >}} 

As you can see from my screen shot above, the domain name on the left is preceded with the company name in green. In this example, “**Dropbox Inc, (US)**” indicates that Dropbox had its identity verified by an independent trusted third-party called a Certificate Authority (CA). When a user clicks on the name, they would see that [DigiCert](http://digicert.com/) was responsible for verifying their identity.

The idea was to provide online identity protection for brands while making it easy for end-users to tell the difference between the legitimate Dropbox website and a deceptive counterfeit.

Browser vendors say that “website identity is broken”. They say people don’t bother to look for identity information inside the browser. I agree with them. I agree because most people can’t tell the difference between the visual indicator that I just described, and the basic padlock.

There is a high bar for ID verification. A website owner must provide documented evidence that they are the true owner of a given organization and a given domain name.

Most people are confused between these two visual indicators because the browser UI and UX isn’t intuitive. The basic padlock is designed to tell users when their connection to a website is encrypted. A padlock doesn’t represent anything related to trust or identity. Browser designers didn’t do a good job with the design of their UI. They should have made website identity more obvious — such as a separate icon on the toolbar — making it completely separate to the padlock.

## Why current security solutions aren’t addressing the problem

According to Patrick Gelsinger, the CEO of VMware during his [RSA keynote in 2019](https://www.youtube.com/watch?v=L-7I6cshYz4); “the security industry’s obsession with the threat model is broken. The ‘Known-Good’ is the way forward”.

[According to Google](https://elie.net/talk/deconstructing-the-phishing-campaigns-that-target-gmail-users/), phishing campaigns are short lived — 7 minutes for a handcrafted campaign that targets a few dozen individuals or organizations, and 13 hours for bulk campaigns.

{{< figure src="/uploads/2019/10/insecure-elephant-4.png" >}} 

Security solutions are reactionary. They’re designed to detect and prevent an attack from “known” threats. This means a threat must be discovered, reported, validated and classified before protection can be initiated.

New threats that are reported to companies such as Google, Microsoft and PhishTank (Cisco), take at least 2 days to validate and classify. It can sometimes take more than a week for known threats to be classified. Contrary to what some people think, no AI-based solution can automatically detect every new threat before innocent victims fall prey to an attack. This means security companies that rely on blacklists are unable to provide ample protection for their customers.

### Modlishka-based phishing attacks make life impossible for security companies

The latest sophisticated phishing techniques discovered in 2019 can now bypass every security solution on the market, including password managers like 1Password and LastPass, as well as 2 factor authentication (2FA).

Created by [Piotr Duszyński](https://twitter.com/drk1wi), [Modlishka](https://github.com/drk1wi/Modlishka) is a reverse-proxy that sits between a user and a legitimate website — like Sharepoint, Dropbox, Gmail or [Salesforce](https://www.salesforce.com/products/what-is-salesforce/).

Typical phishing scams that you probably know about, involve a phishing URL and a counterfeit website. A Modlishka-based phishing scam is different and much worse. Instead of being brought to a fake website, the victim receives **authentic content from the legitimate website**. The reverse-proxy silently redirects all traffic and everything the user types into the legitimate site to the Modlishka server.

Credentials and sensitive information such as a password or crypto wallet address entered by the user are automatically passed on to the threat actor. The reverse proxy also asks users for 2FA tokens when prompted by the website. Attackers can then collect these 2FA tokens in real-time, to access the victims’ accounts.

When I asked Piotr if this attack can bypass any 2FA solution on the market, he said “Hi Paul, yes. Majority of those currently used, as far as I know. The only resistant 2FA is based on the [WebAuthn](https://en.wikipedia.org/wiki/WebAuthn) standard.”

Unfortunately very few people use WebAuthn based 2FA solutions. Unless a security solution can detect the phishing domain, this attack is impossible to stop.

## Wait; doesn’t Google Safe Browser API solve this problem?

In short, no.

### An overview of the service

The Google “[Safe Browser API](https://developers.google.com/safe-browsing/)” is a security service used by almost all mainstream browsers to protect users from deceptive websites. Many security companies have integrated the Google “[Web Risk API](https://cloud.google.com/web-risk/)” inside their products to help protect their customers from the same threats.

{{< figure src="/uploads/2019/10/insecure-elephant-5.png" >}} 

Google recently discovered that its security services are unable to detect Modlishka-based phishing attacks, so they banned all users from signing into their websites when using mobile apps.

When Google says “these platforms”, they’re referring to mobile apps that use a WebView — a framework used by developers to display web content inside their app. A WebView also provides a seamless experience for users because the app opens web links inside the app instead of the native browser. This is why we no longer switch between an app and a browser.

If Google is unable to detect phishing scams inside their Android WebView, it means they can’t detect them inside the desktop or mobile versions of Chrome. They obviously can’t ban people from using their websites while using Chrome — they’re now promoting a hardware USB key as the answer to security.

This is Google admitting that they’re unable to protect users from attackers that impersonate Google’s own login pages, even when they use Chrome and [Google Authenticator](https://www.google.ca/landing/2step/#tab=how-it-works) for 2FA.

If Google is unable to detect every new dangerous URL, nobody can.

## Why we need to empower people

When a dangerous URL slips through network-based and endpoint security solutions, users must rely on their ability to spot a counterfeit website.

### The padlock is putting users in danger

When a user opens a link, the browser padlock is the first thing they look for. It’s a well-known fact that most people rely on the padlock for trust related information. Unfortunately, their reliance on the padlock for trust is one of the main reasons they fall for dangerous websites every hour of every .

A padlock means a given website uses a Domain Validation (DV) certificate to encrypt the transmission of data between the user and a website. It doesn’t mean the website owner is who they say they are.

{{< figure src="/uploads/2019/10/insecure-elephant-6.png" >}} 

I read a LinkedIn article written by the Global Sales Director of a big security company recently. He advises readers to look for the padlock for “trust”. If an industry stakeholder isn’t aware of the danger of this advice, how can we expect their customers to know?

{{< figure src="/uploads/2019/10/insecure-elephant-7.png" >}} 

The number of security companies that continue to advise customers to rely on the padlock would amaze you. This poor advice alone is directly responsible for data breaches, online identity theft, and other attacks that start with dangerous URLs.

If I was granted one wish, it would be for everyone to ignore the padlock — it’s starting to do more harm than good, and I’ll explain why.

## How FREE DV certificates are making the Internet less safe

Every Certificate Authority issues DV certificates. Most CAs charge for them. But today, some automatically issue DV certificates for free — they want to see the entire web encrypted. Whether a website needs to be HTTPS or not is irrelevant to them.

I highly recommend that you [read this amazing post](http://this.how/googleAndHttp/), written by the founder of podcasting, blogging and RSS, and open web advocate, Dave Winer. He explains why the enforcement of “HTTPS Everywhere” is bad for the web. As a significant contributor to W3C Standards and an open web advocate myself, I agree with everything Dave says.

{{< figure src="/uploads/2019/10/insecure-elephant-8.png" title="I’d like to thank Patrick Nohe from thesslstore.com for allowing me to use the graph above" >}}

It is clear from the data that cybercriminals favor free and easy-to-acquire DV certificates when building counterfeit websites for the purpose of attacking organizations, government agencies and consumers.

According to Let’s Encrypt, the automatic issuance of DV certificates for free plays a vital role in scaling the creation of a more privacy-respecting web through widespread encryption. But, it also means it’s cheap, fast and easy for cybercriminals to launch their attacks — on mass scale.

## The volume of cyberattacks that use automatically issued free DV certificates has weakened the Trusted Computing Base (TCB) of the internet in my opinion. And free DV certificates are an existential threat to the safety and wellbeing of society.

In 2017, Let’s Encrypt issued more than [15,000 DV certificates](https://www.thesslstore.com/blog/lets-encrypt-phishing/) for domains that contained the term “PayPal”. Yes, you read that correctly 15,000.

I’m troubled by the lack of response from Let’s Encrypt’s to this problem. I’m one of the two people who co-instigated the creation of the W3C Standard for URL Classification and Content Labeling that replaced PICS in 2009. So I appreciate what it takes to build a keyword checking system — I realize that it would cost time, money and attention. But they have all three. What they lack is motivation. And I don’t understand why.

PayPal is one of the most targeted victims of brand impersonation on the web. Shouldn’t someone at Let’s Encrypt have noticed something smelled off after the first ten, hundred or thousand certificates? Shouldn’t someone have said, “perhaps we should stop issuing certificates with the term “PayPal”?

Why do organizations like Let’s Encrypt and 4Chan refuse to tackle obvious problems that have serious consequences on society?

## Is Let’s Encrypt at fault for phishing attacks?

No, of course not.

But they should accept some responsibility for the fact that their technology is being used with malicious intent as they _can_ do something about it.

According to [MetaCert’s](http://metacert.com/) URL-based threat intelligence system, over 98% of all phishing scams that contain a DV certificate, come from Let’s Encrypt. So while other organizations may offer DV certificates for free, Let’s Encrypt is the biggest contributor to this problem.

### # Allow me to reiterate some facts:

  * 93% of all data breaches start with phishing
  * Phishing URLs outnumber malicious email attachments by five to one
  * 91% of all new phishing sites use a DV SSL certificate
  * Almost every phishing scam that uses a DV certificate is issued by Let’s Encrypt

When I worked at AOL in the 90’s, it was impossible to stop every bad person from doing bad things — but as a company it tried its best. As employees, we took pride in helping to protect our members from harm. We didn’t do a perfect job. Nobody expected us to be perfect. Perfection is not the goal. The goal is to try your best.

For what it’s worth, my own company uses Let’s Encrypt DV certificates. The certificate helps to protect our visitors and customers, and it was free. But do the benefits outweigh the bad? I personally don’t think so. I wouldn’t lose any sleep if Let’s Encrypt stopped operating and all the staff found a more purposeful job. My preference however, would be to see them charge for DV certificates — I would rather pay if it meant making life more difficult, expensive and time consuming for criminals to impersonate brands, breach companies and steal from innocent victims.

Are free DV certificates an existential threat to Internet safety? I will allow you to draw your own conclusions — for me the data speaks for itself.

## Once upon a time there was trust

The people behind the SSL industry knew that the abuse of DV certificates was eventually going to happen. This is why they came up with the concept of “Extended Validation” Certificates in 2007.

When I met [Phillip Hallam-Baker](https://www.comodo.com/resources/home/newsletters/sep-10/header-article.php) in Edinburgh in 2006, where we both gave talks about “trust on the web” at the [WWW2006 conference](http://www2006.wwwconference.org/speakers/walsh/index.html), he explained the concept of displaying website identity inside the browser to me. I thought it sounded amazing, genius even. He was equally impressed by my vision and [proof-of-concept browser add-on](https://www.w3.org/2001/sw/sweo/public/UseCases/Segala/) with visual indicators too —which was formally endorsed by the W3C Symantec Web Education & Outreach program as “one of the most compelling implementations of the Semantic Web”. We were thinking about the same issues before most people.

Unfortunately, the designers working for browser vendors never really implemented the original design concepts. “HTTPS Everywhere” advocates and browser vendors say that people don’t look for website identity indicators because “EV is broken”. This isn’t logical thinking. CAs are only responsible for validating an organization’s identity. Browser vendors are the ones who decide on how to express that identity information to consumers. If anything is broken, it’s the browser vendors’ design implementation.

### Why cybercriminals don’t use EV certificates

The extra validation that organizations go through for EV certificates includes so much additional paperwork, that it costs too much time, money and energy to make it worthwhile for criminals.

Like everything, the extended validation process isn’t 100% perfect. As some researchers discovered, it’s possible to cheat the system. It’s possible to setup a company called PayPal outside the US and then apply for an EV certificate for a domain that looks like paypal.com but is in fact a fake. Some CAs will catch this type of trick while some may not.

Established CAs like Entrust Datacard, Sectigo, DigiCert, GoDaddy and GlobalSign have robust processes for certificate revocation. As soon as an attacker has had their EV certificate revoked, they can never buy another one using the same company. So all of that time, cost and effort to setup a real company can only be used once. Even if you put the cost of verification aside, this is an extraordinary high bar for criminals.

Of the thousands of domains classified as Phishing, Malware or Cryptojacking by MetaCert in the past 3 months, not one of them had an EV certificate. In fact, I spent a considerable effort researching malicious websites that used an EV certificate for this article. In all my research, I was unable to find a single instance of a malicious website that used an EV certificate. And not a single researcher I asked was able to point me to one either.

Just because a threat actor _could_ buy an EV certificate for fraudulent purposes, doesn’t mean they will. The goal isn’t to make something 100% hack-proof. The goal is to make hacking and social engineering cost and time prohibitive for threat actors.

## How browser vendors are railroading everyone

To set the tone, I’d like to quote [Dave Winer](http://this.how/googleAndHttp/):

> The web is an open platform, not a corporate platform.
> 
> It is defined by its stability. 25-plus years and it’s still going strong.
> 
> Browser vendors are guests on the web, as we all are. Guests don’t make the rules. (I replaced “Google” with “browser vendors”)

The decision made by browser vendors to systemically remove website identity UI demonstrates their lack of care and appreciation for the web and its users.

### What browser vendors know that we don’t?

Browser vendors have railroaded CAs, website owners, website creators, security companies, governments, ISPs and end users without providing any evidence to substantiate their decision. While their own implementation of visual indicators are poorly designed, there is no data to suggest that the concept of website identity doesn’t work, or isn’t needed. All of the evidence I put forward suggests the complete opposite.

I haven’t read anything meaningful from any of the browser employees involved in the [CA/Browser Forum](https://cabforum.org/) to give me insight to the data they used to substantiate their strange decisions. When reading through all the discussions on the [Mozilla Dev Security Policy forum](https://groups.google.com/forum/#!topic/mozilla.dev.security.policy/iVCahTyZ7aw%5B1-25%5D), I can’t find a single data point to give me insight to why Mozilla believes the removal of website identity is in the best interest of Firefox users.

## My proposed solution

Thanks to my experience working across many W3C initiatives, and my Chairmanship of the [British Interactive Media Association](http://bima.co.uk/) (BIMA) for three years, I learned a lot about what works and what doesn’t work, when it comes to participating in initiatives that have a lasting impact across entire industries and ecosystems.

###  What I learned:

  1. Everyone has a right to an opinion.
  2. Everyone has a right to have their opinion heard.
  3. Everyone should seek to understand other opinions before seeking to be understood.
  4. Cultural differences bring nuances that are missed by people who are not used to industry initiatives.

When inexperienced contributors get involved in W3C initiatives they rightfully articulate their grievances about specific elements of an initiative or technical specification. But if everyone simply said what was wrong, no Standard, Recommendation or Best Practice would see the light of day.

To accelerate the completion of the W3C Mobile Web Initiative, we would say to each other; “rather than just articulate a problem, please suggest a proposed solution”. I wish browser vendors and commentators who have nothing but negative things to say about EV certificates, would take this approach — it would be more helpful to industry.

Instead, browser vendors say “it’s broken, let’s get rid of it”.

Now that identity UI has been removed from browsers, there is an opportunity for industry to come up with something new and better.

  1. CAs could tighten up their identify verification processes.
  2. CAs could reduce the cost, time and effort of acquiring identity verification.
  3. Browser vendors could design a meaningful icon for the browser toolbar — away from the padlock.
  4. Browser vendors could improve the user experience so website identity is intuitive.

If all of this happened, CAs wouldn’t be accused of overzealous marketing efforts when selling the benefits of identity verification to customers. The benefits would be real and everyone would win.

## Well designed visual indicators work

I have the data to prove that well designed visual indicators combined with a < 0.1% false positive rate for website identity, works. I’m not saying it “can” work. I’m saying it **does** work.

I wish I could point to data points created by another person or another company, as I’ve done throughout this article, but I can’t. No other company or academic researcher, or commentator, has come forward with any meaningful data to prove or disprove my thesis. [MetaCert](http://metacert.com/) can however, provide data to prove my thesis. I’m the founding CEO of MetaCert, so should take everything I say with a pinch of salt, as you would with any other research. That said, MetaCert risks upsetting both CAs and browser vendors equally with this article. One could argue that we’re displacing the need for EV certificates altogether and we don’t rely on browser vendors for anything — although I’d rather combine our efforts with those of the CAs.

My research into the technology and human behavior around browser-based visual indicators started in 2004. And my COO and engineers built the official browser add-ons for dig, Delicious, Yahoo!, eBay, PayPal, Google and Microsoft. So, we’ve been doing this for a while. The data I furnish below is based on very recent findings.

Mozilla recently [announced](https://www.securityweek.com/dns-over-https-coming-firefox) that “70,000 users have already enabled DNS-over-HTTPS (DoH) in their stable versions of Firefox” So, if 70k users is a big enough data set for Mozilla to draw conclusions about an exceptionally disruptive technology change that’s attracting positive and negative feedback, it’s big enough for MetaCert.

## The data

After completely eradicating the [phishing epidemic on Slack](https://cointelegraph.com/news/with-myetherwallet-phishing-surge-do-icos-need-to-use-slack-) for the entire crypto ecosystem in Q4 2017, we came to the conclusion that the threat model and chasing after malicious websites was like playing a game of [whack-a-mole](https://en.wikipedia.org/wiki/Whac-A-Mole) — as soon as you detect and block one, or have it taken down, 10 more pop back up in its place. It’s almost a waste of time in my opinion.

With the biggest database of domains classified as “XXX”, with an error rate of false positives at 0.3%, we also concluded that online pornography grows at such a rapid rate that it’s also impossible to classify every new website before harm can be done.

In December 2017 we decided to try a social experiment. We built a browser add-on for Chrome, Firefox, Opera and Brave. We told users to ignore the browser padlock and instead, rely on MetaCert’s shield, which we added to their browser toolbar. As you know, no matter where you open a link on a computer, it will always open inside your default browser, so we felt this was the best place to provide ultimate protection.

We considered our software as a security solution with built-in anti-phishing awareness. Most end-users didn’t realize it protected them from known malicious websites — so to them it was a personal firewall that made it easy to make better-informed choices about what and who to trust.

We classified as many crypto related websites and social media accounts as we could with our URL-based threat intelligence system as “Verified as Safe”. Whenever a user opened a URL that was “Verified as Safe”, the shield would turn from grey to green. Simple.

{{< figure src="/uploads/2019/10/insecure-elephant-9.png" >}} 

With 85,000 active crypto traders and investors as power users, who incidentally, are the most widely targeted people on the internet for phishing scams, not a single person fell for a dangerous link over a 12 month period. Our experiment seemed to work. But we wanted to dive into the numbers to see if the utility was realized and to see if the new concept had achieved product/market fit.

The solution was so well received, that end-users took to Twitter, requesting website owners to seek verification before they would sign into their website. Some website owners sought verification before being prompted by their users. We took great pride from the fact that even companies like [MetaMask](https://metamask.io/), who had their own anti-phishing security built into their browser add-on, sought the verification of their domain names from MetaCert. When MyEtherWallet realized their DNS was compromised we were the first people they contacted — so we could change the classification from “Verified as Safe” to “Phishing”, [preventing users from losing all of their crypto](https://medium.com/metacert/cryptonite-browser-add-on-prevented-dns-spoofer-from-intercepting-60-000-ether-transaction-c47cf1f8a7be).

### Deep dive into the data

We followed [Sean Ellis’ methodology](https://blog.growthhackers.com/using-product-market-fit-to-drive-sustainable-growth-58e9124ee8db) to find out if we had product/market fit with the new visual indicator. Ellis was the head of marketing at LogMeIn and Uproar from launch to IPO. He was the first marketer at Dropbox, Lookout and Xobni, and he coined the term “growth hacker” in 2010. So, he knows a thing or two when it comes to product/market fit research.

Our goal for the survey was to get feedback from people who had recently experienced “real usage” of the product. The key question in the survey for these people according to Ellis, is:

“How would you feel if you could no longer rely on MetaCert’s green shield?

  1. Very disappointed
  2. Somewhat disappointed
  3. Not disappointed
  4. N/A I no longer use MetaCert

According to Ellis, to get an indication of product/market fit, you’ll want to know the percentage of people who would be “very disappointed” if they could no longer use your product. In his experience, it becomes possible to sustainably grow a product when it reaches around 40% of users who try it that would be “very disappointed” if they could no longer use it.

For this percentage to be meaningful, we needed to have a fairly large sample size. In Ellis’ experience, a minimum of 30 responses is needed before the survey becomes directionally useful. At 100+ responses he is much more confident in the results.

When pushing an update for a browser add-on to end-users, you submit it to the browser store — the store automatically updates every user to the latest version, silently in the background.

We took advantage of the silent update capability. 85k users were prompted with a banner at the top of their browser. There was no way for them to stop it from appearing. And they were unable to close the banner until they clicked on one of the answers to Ellis’ question. We asked “How disappointed would you be if you could no longer rely on the Green Shield?”. Given that some users would have been upset by this interrupted experience with our forced question, we didn’t know what to expect. We did see a small spike in the number of uninstalls that day, so we did pay a small price for this research.

The results came in. **63% of the users said they would be very disappointed if they could no longer rely on the Green Shield**. Over **5,000** users went on to complete the survey with 20 questions. This is the highest number we have come across so far. Email startup Superhuman built an engine over a six month period to achieve product/market fit. They published their detailed journey on the First Round blog — you can read about it [here](https://firstround.com/review/how-superhuman-built-an-engine-to-find-product-market-fit/). By the end of their massive, time intensive journey, they were delighted with 58%. I’m telling you this to emphasize the significance of our findings for website identity — when done properly.

### Our data proves that when designed well, users can come to rely on a visual indicator for website identity.

Today, MetaCert verifies millions of mainstream domains and sub-domains — including automatically classifying highly regulated ccTLDs and gTLDs like .GOV and .BANK. And we now sell the browser-based software to small to midsized businesses (similar to 1Password and LastPass software) via the traditional MSP model as well as enterprises and government agencies.

Again, I’m not pitching “MetaCert” here. What I’m doing is using data to prove that end-users can be trained to rely on a new, better visual indicator for website identity. My motivation in telling this story is to explain to browser employees, why they should look at the data and consider the creation of new UI to protect people who use their software.

If MetaCert, a small seed-funded startup can protect the most widely targeted people from fake websites, with zero victims to date, surly Google, Mozilla, Apple, Opera and Brave, with all of their resources, can try to do something better.

I hope my data and analysis also provides some substance for the Certificate Authorities to use their combined voices to lobby the browsers in the CAB/Forum. I’m not sure if there is much hope, but it’s worth fighting on behalf of the web.

It’s not too late for Mozilla. There’s time. I would like to urge Mozilla to reconsider the removal of visual indicators from Firefox. Instead, let us rethink the design elements so we can provide a safer internet.

## About the author, Paul Walsh

Paul is the founder and CEO of [MetaCert](http://metacert.com/), a security company that aims to eradicate all cyberattacks that start with dangerous URLs by telling you which links are safe and which websites you can trust. He founded the first software testing company to become an Associate member of the GSM Association. Previously, as part of the New Technologies team at AOL during the 90’s, Paul helped to launch technologies such as AIM, X2 56K modem protocol, online games, internet radio, as well as integrated browsers and search engines.

As one of the seven original founders of the W3C Mobile Web Initiative, Paul was tasked with rewriting Tim Berners-Lee’s vision of the “One Web”. He was a member of the W3C Advisory Committee between 2004–2009. He co-instigated the creation of the W3C Standard for URL Classification in 2004, formally replacing PICS in 2009. He is a named contributor to 8 W3C technical specifications across four initiatives. Paul holds a family of foundational patents for anti-phishing and website identity visual indicators inside the mobile app WebView. Paul was Chair of the British Interactive Media Association between 2006–2009 after serving as a member of its Executive in 2005. He also co-founded Shanti Life with his wife Sheetal Mehta, a charity that helps to empower women through low interest microloans for sanitation, and financial literacy training in India.