# Proposed use case — narrowly-delegated trading agents

Addresses the bonus criterion: *"Willingness to go beyond the first contract and
provide us an initial use case."*

I have kept verified facts and speculation clearly separated. Everything in
**Verified** was observed in this pilot and is backed by a log. Everything in
**Proposed** is a design sketch I have *not* built.

---

## Verified in this pilot

These are the primitives the idea rests on, and what I actually saw them do:

| Primitive | Observed |
|---|---|
| `kv-store` + `map-entry-set` | A value seeded through the control plane was read back by the contract inside the enclave ([logs/04-invoke.txt](logs/04-invoke.txt)) |
| Map ACLs | Reads are denied to any contract id not on the ACL — including the same contract after a version bump ([logs/06-acl-break.txt](logs/06-acl-break.txt)) |
| `agent-auth-update` grants | The grant carries `versionReq`, `functions` and `allowedHosts`; outbound hosts are authorised per-call from the caller's grant, not by the contract |
| WIT imports as capability set | The component's entire capability surface is fixed at build time and visible via `wasm-tools component wit` ([logs/01-build.txt](logs/01-build.txt)) |

The last two are the interesting part: **what the code may reach is decided by
the party who signs the grant, not by the code**, and **what the code can do at
all is fixed and inspectable before it runs**.

---

## The problem I want to point at

Automated trading agents need an exchange API key with trade permissions. Today
that key normally sits in the environment of a long-running process. Two
consequences I have hit directly in my own work:

1. Compromise of the host is compromise of the funds — the key is readable from
   the process environment.
2. Delegating a strategy to someone else's code means handing over the key
   itself, with no way to express "may place orders on this venue, may not
   withdraw".

I am not claiming this is why non-custodial strategy marketplaces are rare —
that would need evidence I do not have. I am claiming it is a real constraint I
have had to work around.

## Proposed shape

A contract `z:<tid>:strategy` exporting three functions:

- `evaluate(snapshot) -> signal` — pure, imports no HTTP capability at all, so
  it is cheap to audit and structurally incapable of egress.
- `place-order(signal) -> receipt` — reads the venue key from `secrets`, calls
  the venue, returns only order id and fill status.
- `report(range) -> pnl` — read-only aggregation.

The capital owner's grant authorises `evaluate` + `place-order` against exactly
one venue host and deliberately omits any withdrawal function. Revocation is a
grant update rather than a key rotation, which today is the only real remedy and
requires touching every deployment holding that key.

What this buys, given the verified primitives: the strategy author never needs
the key in their own environment, the owner keeps unilateral and immediate
revocation, and the reachable host set is enforced outside the strategy code.

## What this does *not* give you — limits I checked

I want to be explicit here, because the obvious pitch overstates the guarantees:

- **The operator does see the key.** Seeding goes through `map-entry-set` from
  the tenant's own environment (`scripts/invoke.ts`). The protection is against
  the *strategy author* and against host compromise afterwards — not against
  the tenant operator, who supplies the value in the first place.
- **The contract is not prevented from leaking the secret.** It receives the key
  as an ordinary `String` (`src/search.rs:180`). A malicious or careless
  contract could log or return it. The guarantee is capability confinement plus
  auditability, not information-flow control — so third-party strategies still
  require code review, and `logging` is itself a capability worth withholding.
- **Registration does not pin what executes.** `source_hash` is optional in the
  register payload and documented as never constraining execution, so
  "the reviewed hash is what ran" does not hold as stated. Combined with the
  documented warning that invocations route to the *latest* registered version
  even when an older one is pinned, version handling is the area I would want
  hardened before trusting capital to it. See finding #8.
- **Venue integration is not a drop-in swap.** Duffel takes a bearer token;
  most exchange APIs need request signing with nonce/timestamp and a
  canonicalisation scheme. Whether that fits cleanly inside the enclave
  (particularly with `http-with-placeholders`, which substitutes profile fields
  rather than signing) is the first thing I would prototype.
- **Latency.** Enclave round-trips suit portfolio and swing automation, not
  latency-sensitive execution.
- **Agent funding is unresolved.** The docs note metered calls bill the calling
  identity, that an agent DID starts at zero, and that there is "currently no
  documented self-serve path" to fund one. A marketplace of third-party agents
  needs that path to exist.

## Why I would build it here anyway

The parts that are hardest to build yourself — attested execution, a secret
store the code can read but the operator's other processes cannot, and
per-caller egress authorisation — are exactly the parts already working. Two of
the four limits above are documentation and version-handling issues rather than
architectural ones.
