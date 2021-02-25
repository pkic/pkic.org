---
authors:
- Rick Andrews
date: "2014-11-18T18:30:21+00:00"
dsq_thread_id:
- 3238327616
excerpt: SHA-1 is a cryptographic hash algorithm that is most commonly used today
  in TLS/SSL certificates on the Internet. It has almost completely replaced older
  algorithms like MD2, MD4 and MD5, which were phased out when practical attacks against
  those algorithms became widely known.
keywords:
- attack
- tls
- ssl
tags:
- Attack
- SSL/TLS
title: The Cost of Creating Collisions Using SHA-1


---
SHA-1 is a cryptographic hash algorithm that is most commonly used today in TLS/SSL certificates on the Internet. It has almost completely replaced older algorithms like MD2, MD4 and [MD5][1], which were phased out when practical attacks against those algorithms became widely known.

If you do a simple web search, you’ll find a number of online services that claim to “crack” SHA-1 and other hash functions. These generally use a computer’s CPU to build and search through a _rainbow table_, which contains the hash value that results from a number of expected inputs, and allows you to “reverse” the hash algorithm. Give them a hash value and they will look in their table to see if they have the input that resulted in that hash value. If they haven’t pre-computed the hash value for the data you’re looking for, they won’t find anything. They’re intended as password recovery services, since many user authentication systems store the hash values of passwords rather than the passwords themselves. Many years ago, we thought this was safe since good hash functions were considered irreversible (if someone has the hash value without the corresponding input, they can’t reverse the algorithm to recover the input), and computers didn’t have enough memory or storage to save and process large rainbow tables. Today, rainbow tables are commonly used to associate hash values with passwords and vice versa.

Once the security industry understood how rainbow tables could be used to reverse a hash, we responded by introducing the concept of “salting”. Instead of just hashing a password, one would pick a pseudo-random number, attach it to the start of the password, and then hash the resulting combination. If one was careful to use a different pseudo-random number for each hashed password, one could defeat rainbow tables, since it wouldn’t be possible to build rainbow tables for all combinations of salt and expected password values.

Clearly, these rainbow table-based services can’t be used to crack the hash on a certificate, and generate another certificate that hashed to the same value as a target certificate. The best known attack is a brute-force attack, where you simply try all combinations (or as many as possible, until you give up). To effectively carry out that kind of attack, you really need special hardware to perform brute-force guessing.

### Hardware to the Rescue

Initially, graphics processing units (GPUs) were used to achieve a much higher number of guesses-per-second since a GPU can be reprogrammed to run any kind of attack code. ([This article][2] explains why GPUs are faster than the CPUs in typical computers.) A researcher once used an [Amazon GPU cluster][3] to carry out such an attack, and [specialized machines][4] can also be used to find SHA-1 collisions.


  __$1__


Still faster are chips known as Application Specific Integrated Circuits (ASICs). [This machine][5], for example, uses ASICs to mine Bitcoins. Like FPGAs, an ASIC is not reprogrammable.

SHA-1 hashes take less time to compute than SHA-256 hashes, but [not much less][6]: a SHA-1 hash can be done in around 70% of the time it takes to compute a SHA-256 hash. That means that an FPGA reprogrammed to do SHA-1 hashes can perform around 1.4 times as many SHA-1 hashes as its SHA-256 rating.

The take-away is that we have today a number of extremely powerful, relatively low-cost options for attempting a brute-force SHA-1 collision, and they’ll just get better and cheaper over time.

### Why Should Anyone Care?

Nearly two years ago, noted cryptographer Bruce Schneier [opined][7] on when we’ll see a brute-force SHA-1 collision:

> “A collision attack is therefore well within the range of what an organized crime syndicate can practically budget by 2018, and a university research project by 2021…Since this argument only takes into account commodity hardware and not instruction set improvements (e.g., ARM 8 specifies a SHA-1 instruction), other commodity computing devices with even greater processing power (e.g., GPUs), and custom hardware, the need to transition from SHA-1 for collision resistance functions is probably more urgent than this back-of-the-envelope analysis suggests.”

Schneier’s analysis concludes that finding a SHA-1 collision would cost approximately $700,000 USD by 2015, $173,000 USD by 2018, and $43,000 USD by 2021. These numbers are considered within the range of an organized crime syndicate in 2018, and a university project by 2021.

Partially due to the popularity of BitCoin and other cryptocurrencies, a determined attacker now has access to far more computing power than ever before. And if they were to use that power to create an intermediate CA certificate that was signed by a root certificate trusted in major browsers, then they could issue fake SSL certificates for any website. Many cryptographers agree with Schneier that we’re close to the point at which we can no longer safely rely on SHA-1. By making a concerted effort to phase out SHA-1 now, we’ll be able to minimize the damage caused when SHA-1 truly gets broken. That’s one reason why the members of the CA Security Council are working to transition our customers to SHA-256 certificates as quickly as possible.”

 [1]: http://www.theregister.co.uk/2014/11/05/md5_hash_collision/
 [2]: https://en.bitcoin.it/wiki/Why_a_GPU_mines_faster_than_a_CPU
 [3]: http://www.geek.com/news/researcher-cracks-sha-1-hashes-for-2-10-with-amazons-cloud-service-1295926/
 [4]: http://arstechnica.com/security/2012/12/25-gpu-cluster-cracks-every-standard-windows-password-in-6-hours/
 [5]: http://www.hongkiat.com/blog/bitcoin-mining-machines/
 [6]: http://en.wikipedia.org/wiki/SHA-1
 [7]: https://www.schneier.com/blog/archives/2012/10/when_will_we_se.html