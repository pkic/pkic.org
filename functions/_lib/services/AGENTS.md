# Service and use-case guidance

- Organize code by bounded domain and explicit use case, with filenames that describe business intent.
- A state-changing use case owns the complete atomic unit of work, including guarded state transition, audit/history rows, and outbox inserts.
- Statement builders build statements but do not execute them. Persistence adapters do not send email or call external providers.
- Do not create generic `commands`, `management`, `catalog-repository`, or `outbox-statements` buckets. Name the domain concept and boundary directly.
- Prefer set-based read models and batch related statements. Avoid N+1 queries and unbounded result sets.
- Recognize specific invariant conflicts. Never catch every D1 error and reinterpret it as a concurrency race.
- A lost compare-and-set must not leave dependent history, audit, or outbox rows behind.
