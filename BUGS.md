# Findings — Terminal 3 ADK, 2026-08-08

Thirteen findings from completing the Quickstart and the five-step Walkthrough on
**testnet**, with `@terminal3/t3n-sdk@4.25.0`, Node v24.18.0, Rust 1.97.1,
against the reference contract `z-tenant-flight`.

Each finding cites either a log in [logs/](logs/), a line in the shipped type
definitions / reference source, or a documentation page by URL. Claims that rest
on the web documentation are quoted with links so they can be checked directly —
I did not snapshot those pages, so they reflect their state on 2026-08-08.
Where I could not verify something first-hand, it says so explicitly.

Three findings (#1, #2, #3) stop the published samples from running at all.

| # | Area | Severity | One-line | Evidence |
|---|---|---|---|---|
| 1 | Docs / Quickstart | **Blocker** | `trustAnchor` is required by the type but missing from the published samples | [07](logs/07-stderr-volume.txt) |
| 2 | Node API | **Blocker** | `GET /api/trust-manifest` → 405; no safe way to obtain a real anchor | [10](logs/10-trust-manifest.txt) |
| 3 | Docs / Set-up | **Blocker** | `tenant.me()` does not exist in the SDK | type defs, quoted in §#3 |
| 4 | Docs contradiction | High | `tenant_did()` guidance contradicts the WIT *and* the reference contract | [04](logs/04-invoke.txt) |
| 5 | Reference repo | Medium | `cargo test --lib` as documented cannot execute | [05](logs/05-cargo-test.txt) |
| 6 | SDK semantics | Low | `TenantClient.getEnvironment()` returns `undefined` | [03](logs/03-register.txt) |
| 7 | SDK / DX | Medium | A single error prints 2.13 MB of minified bundle to stderr | [07](logs/07-stderr-volume.txt) |
| 8 | Platform | High | Re-registering a contract breaks its own map ACL | [06](logs/06-acl-break.txt) |
| 9 | Docs | Low | Quickstart states the SDK defaults to production; it defaults to testnet | type defs + runtime, §#9 |
| 10 | Reference repo | Low | Three different versions declared across README, WIT and Cargo | source, cited in §#10 |
| 11 | SDK | **High** | `token.getUsage()` — the SDK's only usage method — fails on the wire | [08](logs/08-credits.txt) |
| 12 | Platform | **High** | A version accepted by `register` is rejected at invoke, and is reported as latest | [09](logs/09-version-pinning.txt) |
| 13 | Docs | Medium | Docs warn that explicit version pins are ignored; pinned calls in fact succeed | [09](logs/09-version-pinning.txt) |

---

## #1 — `trustAnchor` is required by the type, absent from the published samples

**Severity:** Blocker — the Quickstart cannot complete as published.

`T3nClientConfig` declares it required, and explains why in unusually strong terms:

```ts
/**
 * **Required.** Client-pinned trust anchor the node's DKG attestation
 * is verified against before the handshake trusts its ML-KEM key (SP-003).
 * ...
 * It is a required field precisely so no caller can omit it by accident —
 * bypassing verification must be a visible, grep-able choice.
 */
trustAnchor: TrustAnchorOrUnsafe;
```

The [Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart)
sample omits it. Running that sample verbatim:

```
TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')
    at isUnsafeTrustServer (index.esm.js:2:1011440)
    at assertNodeTrusted (index.esm.js:2:1110564)
    at async T3nClient.handshake (index.esm.js:2:1128669)
```

Internally `assertNodeTrusted(url, key, opts)` passes `opts` straight to
`isUnsafeTrustServer(opts)`, which dereferences it without a guard. With no
`trustAnchor` in the config, `opts` is `undefined`.

**Expected:** either the samples pass `trustAnchor`, or the constructor fails
with a named error naming the missing field.

**Suggested fix:** add `trustAnchor` to the Quickstart, Set-up-dev-env and
Invoke samples and guard the constructor. Worth noting the field's own
documentation argues that omitting it must never happen by accident — which
makes its absence from the samples look like an oversight rather than intent.

Full reproduction: [logs/07-stderr-volume.txt](logs/07-stderr-volume.txt) (the
sample run there is the documented one, with `trustAnchor` removed).

---

## #2 — `fetchTrustedManifest()` fails with 405 on testnet

**Severity:** Blocker for the secure path.

Having diagnosed #1, the correct fix is the documented one — fetch the signed
operator manifest and pin it:

```ts
const trustAnchor = await fetchTrustedManifest("testnet");
```

**Actual:**

```
Error: Trust manifest request to
https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest failed:
405 Method Not Allowed
```

Verified directly against the node:

| Request | Result | `x-request-id` |
|---|---|---|
| `GET /api/trust-manifest` | **405** | `24475a99-d03f-4f7a-857f-34142a781f03` |
| `POST /api/trust-manifest` | 400 | `2aaddc3a-41dc-4e1f-ac75-79de942c6fa0` |
| `GET /status` | 200 | `8a848cb2-0e01-4876-8f4f-64fd5cb518d9` |

The node is healthy and serves `/api/*` as JSON-RPC over POST; the SDK issues a
GET. The docs state the manifest "is served by the node itself at
`/api/trust-manifest`", so either the route is not deployed on testnet or the
SDK uses the wrong verb.

**Why this matters beyond convenience.** The SDK's own docs state that without a
real anchor "a network attacker with their own TDX VM can hand the SDK a
forged-but-valid attestation for a key it controls and read every session".
In my run, with the documented path returning 405, the only way I found to
finish the tutorial was `{ unsafe_trust_server: true }` — which disables
attestation verification. If others hit the same 405, they will land on the
same line, and it is the kind of line that tends to survive a copy-paste into
later code.

**Suggested fix:** repair the route on testnet; until then, publish the interim
anchor values rather than leaving the opt-out as the de facto path.

Full probe output, including the `x-request-id` values above:
[logs/10-trust-manifest.txt](logs/10-trust-manifest.txt).

---

## #3 — `tenant.me()` does not exist

**Severity:** Blocker for the Set-up-dev-env step.

Documented:

```ts
await tenant.me(); // throws if something's wrong; confirms the client actually works
```

**Actual:** `TypeError: tenant.me is not a function`

`TenantClient` in 4.25.0 exposes `requireConfig`, `admitForOrg`,
`getEnvironment`, `canonicalName` and the namespaces `tenant`, `maps`,
`contracts`, `token`. There is no `me`.

It is presented as the step that "confirms the client actually works", so it is
both the first thing a developer runs and the first thing that breaks.

**Suggested fix:** use an existing call in the sample, or add `me()`.

---

## #4 — `tenant_did()` guidance contradicts the WIT and the reference contract

**Severity:** High — the documentation steers developers into a defect.

The WIT interface returns bytes (`wit/deps/host-tenant-1.0.0/package.wit:16`):

```wit
tenant-did: func() -> list<u8>;
```

Terminal 3's own reference contract hex-encodes it — `src/search.rs:179`,
`src/booking.rs:168`:

```rust
let tid = tenant_context::tenant_did();
let map_name = alloc::format!("z:{}:secrets", hex::encode(&tid));
```

These two agree. The web documentation contradicts both. [Common
errors](https://docs.terminal3.io/developers/adk/tips/common-errors) lists it
as a named gotcha:

> Hex-encoding a DID before building a map path — `format!("z:{}:secrets",
> hex::encode(&tenant_did()))` double-encodes — `tenant_did()` already returns
> the string form … **Fix:** Use `tenant_did()`'s return value directly.

**The documented "fix" cannot compile.** `Vec<u8>` does not implement
`Display`, so `format!("{}", tid)` is a type error. And the un-"fixed" code
demonstrably works: with `hex::encode` intact, the contract read
`z:<tid>:secrets` successfully in this run — execution proceeds past the KV read
and only fails later at Duffel ([logs/04-invoke.txt](logs/04-invoke.txt)).

**Suggested fix:** correct the Walkthrough and drop the gotcha row, or change
the WIT to return a string. As written, the guidance contradicts the very
example it is meant to explain.

*Related, unverified:* [Seed API key](https://docs.terminal3.io/developers/adk/tips/seed-api-key)
shows `kv_store::get("secrets", …)` with a bare tail while the reference
implementation uses the full `z:<tid>:secrets` path. I did not test the bare-tail
form, so I am flagging the inconsistency rather than asserting which is correct.

---

## #5 — `cargo test --lib` from the reference README cannot execute

**Severity:** Medium.

`z-tenant-flight/README.md:51` documents, under the heading "Running tests (native)":

```bash
cargo test --lib
cargo clippy --all-targets -- -D warnings
```

The repository ships `.cargo/config.toml:1-2` pinning the build target:

```toml
[build]
target = "wasm32-wasip2"
```

So the test harness is compiled to WASM and then executed as a native binary:

```
error: test failed, to rerun pass `--lib`
Caused by: could not execute process .../z_tenant_flight-<hash>.wasm (never executed)
Caused by: Permission denied (os error 13)
```

The heading says "native", which the pinned target prevents. This is a plain
default-toolchain Ubuntu install with no WASM runner configured; a machine with
`binfmt_misc` or a cargo runner set up for WASM would behave differently.

**Workaround, verified:** passing the host triple explicitly runs the suite
green — 7 passed, 0 failed. Both the failure and the fix are in
[logs/05-cargo-test.txt](logs/05-cargo-test.txt):

```bash
cargo test --lib --target x86_64-unknown-linux-gnu
```

**Suggested fix:** document the host-target form, or scope the pinned target so
tests build for the host.

---

## #6 — `TenantClient.getEnvironment()` returns `undefined`

**Severity:** Low — inconsistent semantics rather than an outright defect.

```ts
setEnvironment("testnet");
const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });
tenant.getEnvironment();   // → undefined
```

Module-level state is correct at that moment: the SDK's own `getEnvironment()`
returns `"testnet"` and `getNodeUrl()` resolves the testnet URL. Only the
accessor on `TenantClient` is empty.

To be fair to the SDK: `TenantClientConfig.environment` is optional and the
script does not pass it, so the accessor faithfully returns what is in the
config. The surprise is that a module-level `setEnvironment()` governs URL
resolution but is not reflected here — two sources of truth for one concept.

**Suggested fix:** fall back to the active module environment, or document that
the accessor reports only the explicitly-passed value.
See [logs/03-register.txt](logs/03-register.txt).

---

## #7 — A single SDK error prints 2.13 MB of minified bundle to stderr

**Severity:** Medium (developer experience).

Measured on one failed handshake — the documented Quickstart sample, i.e. the
`trustAnchor` case from #1:

| Metric | Value |
|---|---|
| Total stderr | **2 233 151 bytes** |
| Of which lines >2000 chars (the minified bundle) | 2 231 910 bytes (99.94%) |
| Actually useful content | the last ~10 lines |

Full measurement: [logs/07-stderr-volume.txt](logs/07-stderr-volume.txt).

On a terminal this scrolls the real error out of the scrollback; in CI it floods
the log. It compounds #1: the underlying cause is one missing field, but the
signal is buried under two megabytes of `_0x` identifiers.

I observed this on errors thrown from inside the SDK during handshake; I have
not characterised every error path, so I am not claiming it applies universally.

**Suggested fix:** ship a source map, or keep the bundle body out of the error frame.

---

## #8 — Re-registering a contract breaks its own map ACL

**Severity:** High — hits on the second deploy, not the first.

Reproduced deliberately in [logs/06-acl-break.txt](logs/06-acl-break.txt):

```
[1] ACL of z:<tid>:secrets currently names contract_id 538
[2] re-registered flight v0.1.2 -> NEW contract_id 540
[3] invoking z:<tid>:flight v0.1.2 WITHOUT touching the map ACL
[4] RESULT: contract error: kv read: ... read denied: access denied:
    TenantContract(did:t3n:<tid>/540) cannot read map "z:<tid>:secrets"
    [request_id 1fd60ee7-13d1-480d-9a7f-963bfd331d64]
```

A version bump mints a new `contract_id`, and the map ACL still names the old
one, so the contract can no longer read the secret it owns.

The failure is *loud* — the error explicitly says `read denied` and names the
new id. The problem is discoverability of the cause and of the remedy: the
[register page](https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract)
acknowledges the hazard in a warning box ("there is currently no API to fetch a
tail's *current* `contract_id` after re-registering"), but the Walkthrough never
instructs you to re-issue the ACL after a re-register, and there is no
`contracts.get(tail)` to recover the mapping later.

In fairness: `contracts.register()` *does* return the `contract_id` at
registration time, so the id is available if you record it. The gap is
recovering it afterwards, and the missing step in the tutorial.

**Workaround** (in `scripts/invoke.ts`):

```ts
await tenant.maps.update("secrets", {
  writers: { only: [CONTRACT_ID] },
  readers: { only: [CONTRACT_ID] },
});
```

**Suggested fix:** re-point ACLs on re-registration, or expose
`contracts.get(tail)` returning the live id — and add the re-issue step to the
Walkthrough.

---

## #9 — Quickstart states the wrong default environment

**Severity:** Low.

The [Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart)
says:

> `setEnvironment("testnet"); // the SDK defaults to production — set this explicitly while building`

and repeats it: "It defaults to `production`, which is why setting it explicitly
matters."

In 4.25.0 the shipped default is `testnet` — both in the type definitions and at
runtime, where `DEFAULT_ENVIRONMENT` prints `testnet`.

Setting the environment explicitly is still good practice, but the stated reason
is wrong, and a developer who trusts the docs may assume an unset SDK is talking
to production when it is not — or, worse, invert the assumption later.

---

## #10 — The reference contract declares three different versions

**Severity:** Low.

| Source | Version |
|---|---|
| `README.md:3` | v0.3.0 |
| `wit/world.wit:19` | `z:tenant-flight@0.4.0` |
| `Cargo.toml` / `src/lib.rs:41` | 0.4.1 |

Harmless in isolation, but the walkthrough asks you to reason about versions
(register with a rising `version`, pin `versionReq` in grants), so three
disagreeing numbers in the example project make an already-subtle area harder.
Note these are distinct from the *registered* contract version (`0.1.x` here),
which is chosen by the tenant.

---

## #11 — `token.getUsage()` is broken; credit balance is unreadable

**Severity:** High — you cannot see a metered resource you are spending.

`TenantTokenNamespace` exposes exactly one method, `getUsage`. It fails on the
wire, both with an argument and without — the probe calls the no-argument form
only inside the `catch` of the `{}` form
([credit-check.ts:25-34](scripts/probes/credit-check.ts)), so the error below
being reached is itself proof that both calls failed. Only the second error text
was captured:

```
RPC Error: invalid token.get-usage params: invalid type: string
"<redacted-opaque-value>", expected struct GetUsageParams
[request_id cab7d7a5-065e-49fe-b749-fb6bc2be83b7]
```

The SDK sends a bare string where the node expects a `GetUsageParams` struct.
There is no `balance()` method anywhere on the client, so **there is no
programmatic way to read your credit balance or consumption at all**.

**Why it matters.** Credits are consumed silently until an operation fails.
The registration I attempted required **189.09 tokens** (`required=189091682`
base units, `BASE_UNITS_PER_TOKEN = 1_000_000`) — I did not find that price on
any documentation page I checked, and cannot tell from the outside whether it is
fixed or varies with component size. Roughly fifteen registrations over a few
hours of ordinary debugging were enough to drain the starting grant. The first
signal was a failed operation:

```
InsufficientCredit (account=<tid>, required=189091682, available=187116983)
```

That error is actually the *good* part: it reports both numbers, and is the only
way I found to learn the price of an operation or the remaining balance.

Continuing until the balance hit zero surfaced a second price, two orders of
magnitude apart from the first:

```
contracts.register  -> InsufficientCredit (required=189091682,   available=187116983)   ~189 tokens
execute (invoke)    -> InsufficientCredit (required=10000000000, available=0)         10 000 tokens
```

An invocation appears to require ~53× what a registration does. Whether that is
a real per-call price or a reserve/escrow held for the call, I cannot tell from
the outside — which is precisely the problem. With `getUsage` broken there is no
way to see this coming, budget for it, or explain it to a teammate.

**Suggested fix:** fix the `getUsage` param encoding, add a balance accessor, and
publish the cost of `register`/`execute`. A developer should not have to run out
of a resource to discover what it costs — twice, at two different prices.

Full reproduction — the `getUsage` RPC error and both `InsufficientCredit`
responses quoted above: [logs/08-credits.txt](logs/08-credits.txt).

---

## #12 — A version accepted by `register` is rejected at invoke — and is reported as latest

**Severity:** High — breaks the default call path, though an explicit version
pin still works as a workaround (see #13).

`contracts.register()` accepted version `2.220.1647`. Invoking the same contract
then failed:

```
CALL RETURNED: Invalid action request: Invalid semver format: 2.220.1647
```

The registration and invocation paths accept different sets of version strings:
registration takes one that execution then refuses to parse. Worse, the newest registered version becomes what
`getScriptVersion()` reports, so the *default* call path is the broken one:

```
getScriptVersion() reports: 2.220.1647
version 2.220.1647   -> rejected: invalid semver
version 0.2.0        -> reached contract + egress (full chain works)
version 0.1.3        -> reached contract + egress (full chain works)
version 0.1.0        -> reached contract + egress (full chain works)
```

So the contract is not lost — pinning an earlier version explicitly still works
(#13), and that is the workaround. What breaks is the documented flow,
`getScriptVersion()` → `execute`, which is what the walkthrough teaches and what
any caller resolving "latest" will hit. Registering a newer valid version would
also fix it, but that costs credits (#11), so a developer who hits this near the
end of their grant is left with the workaround rather than the clean fix.

**Narrowed down.** Five further probes, one version per run, driven by
[scripts/probes/semver-one.ts](scripts/probes/semver-one.ts) — logs
[11](logs/11-semver-major.txt), [12](logs/12-semver-repro.txt),
[13](logs/13-semver-narrow.txt), [14](logs/14-semver-pair.txt),
[15](logs/15-semver-major3.txt). Together with the two earlier probes:

| Version | Tail | Registers | Invoke |
|---|---|---|---|
| `0.3.1647` | `probe` | yes | reaches contract |
| `1.220.1647` | `probe` | yes | reaches contract |
| `2.0.0` | `probe2` | yes | reaches contract |
| `2.220.1647` | `probe2` | yes | **Invalid semver format** |
| `2.220.0` | `probe3` | yes | reaches contract |
| `2.0.1647` | `probe4` | yes | **Invalid semver format** |
| `3.0.1647` | `probe5` | yes | **Invalid semver format** |

**What this shows.** With `major = 2`, `patch = 0` reached contract code at both
`minor = 0` and `minor = 220`, while `patch = 1647` was rejected at both minor
values. `3.0.1647` was rejected; `1.220.1647` and `0.3.1647` were not.
Registration accepted all seven. So the two paths accept different sets of
version strings, and no single component explains the rejected set.

**What it does not show.** These seven points do not establish that every major
of 2 or above is affected, that the minor component is universally irrelevant,
or that there is a monotonic patch threshold to find: no patch value between 1
and 1646 was tested, so `1647` is a tested value rather than a demonstrated
boundary.

The rejection appeared under four different tail names, which makes state
accumulated on the original `flight` tail an unlikely explanation. Note that
probes 11 and 12 shared the tail `probe2` — `2.0.0` was registered there first —
so not every run started from an empty tail.

The rejections carry a JSON position: `column 94` for the eight-character
versions, `96` for the ten-character one, shifting by exactly the difference in
version length. Together with the `Invalid action request` prefix, and with the
accepted versions reaching contract code, that is consistent with rejection
while deserialising or validating the action request, before contract execution.
It does not identify which server-side layer performs the check — a custom
semver parser invoked during deserialisation would look the same from outside.

**Suggested fix:** align the accepted version domain across both paths — either
reject at registration what invoke cannot parse, or widen invoke to accept what
registration already stores. Which way round is a product call; the defect is
that the two disagree.

Full reproduction — registration of `2.220.1647`, the invoke-side rejection and
the version matrix above: [logs/09-version-pinning.txt](logs/09-version-pinning.txt).

---

## #13 — Docs warn that version pinning is ignored; pinning actually works

**Severity:** Medium — the warning describes behaviour that does not occur, and
omits the one that does.

The [register page](https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract)
warns:

> once a higher version is registered for a tail, invocations continue to route
> to the *latest* registered version — even ones that explicitly pass an older
> `version` in `contracts.execute()`.

Tested directly (output above, finding #12): with the reported latest version
failing, calls that explicitly passed `0.2.0`, `0.1.3` and `0.1.0` each
completed successfully. They therefore did **not** get routed to the currently
reported latest version, which is what the warning predicts. (Since all these
versions are the same WASM, I cannot prove from the response alone which exact
build executed — distinguishing that would need visibly different builds. What
is certain is that the calls succeeded while "latest" was broken.)

This matters twice over. First, the warning discourages the one workaround that
actually rescues finding #12. Second, the real hazard — that
`getScriptVersion()` can hand you a version the invoke path rejects — is not
documented at all.

**Suggested fix:** correct or remove the warning, and document the real failure
mode instead.

Full reproduction — the explicit-version calls that succeeded while "latest" was
broken: [logs/09-version-pinning.txt](logs/09-version-pinning.txt).

---

## Method note

Findings were re-checked against the shipped type definitions and reference
sources by an independent review pass before publication; several claims in an
earlier draft were weakened or dropped where the evidence did not support them
(notably #6, reclassified from defect to inconsistent semantics, and #7/#8,
which were re-run to produce the logs cited above rather than asserted from
memory). Claims that rest on the web documentation are cited with links so they
can be checked directly.
