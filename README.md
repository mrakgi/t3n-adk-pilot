# Terminal 3 ADK — Quickstart & Walkthrough completion report

Submission for the Superteam Earn bounty
[*Create Agent ID, claim free tokens, & deploy first RUST contract on the network*](https://superteam.fun/earn/listing/ai-id/)
by **LOL ventures**.

Everything below was run end to end against T3N **testnet** on 2026-08-08.
Ten findings came out of it — written up with reproductions in
[BUGS.md](BUGS.md). The bonus criterion (a use case beyond the first contract)
is in [USE-CASE.md](USE-CASE.md).

---

## Result

| Step | Status | Evidence |
|---|---|---|
| Agent ID / tenant DID claimed | done | `did:t3n:6810d27cd637c1873551e25606ce7fc48a5edbe5` |
| Free test credits claimed | done | campaign code `Superteam` |
| Quickstart — authenticated session | done | [logs/02-quickstart.txt](logs/02-quickstart.txt) |
| Walkthrough 1 — write contract | done | reference contract `z-tenant-flight` |
| Walkthrough 2 — build to WASM component | done | [logs/01-build.txt](logs/01-build.txt) |
| Walkthrough 3 — register contract | done | [logs/03-register.txt](logs/03-register.txt) |
| Walkthrough 4 — invoke contract | done | [logs/04-invoke.txt](logs/04-invoke.txt) |
| Walkthrough 5 — test | done | [logs/05-cargo-test.txt](logs/05-cargo-test.txt) |

Deployed contract:

```
z:6810d27cd637c1873551e25606ce7fc48a5edbe5:flight
contract_id 537 (v0.1.0) → 538 (v0.1.1) → 540 (v0.1.2) → 541 (v0.1.3)
```

The final invocation runs the contract inside the enclave, reads the API key
from `z:<tid>:secrets`, and makes an authorised outbound call to
`api.duffel.com`. Duffel answers **HTTP 401** because the seeded value is the
placeholder `duffel_test_PLACEHOLDER` — no Duffel account was created for this
exercise (`scripts/invoke.ts` prints which value it seeded). Everything owned by
T3N works; the only failure is a third-party rejecting a deliberately invalid
token. That is the intended end state, and it demonstrates the whole chain:
enclave execution → KV secret read → authorised egress → upstream response
surfaced to the caller.

---

## Environment

| Component | Version |
|---|---|
| OS | Ubuntu (x86_64), headless server |
| Node.js | v24.18.0 |
| `@terminal3/t3n-sdk` | 4.25.0 |
| Rust | 1.97.1 (2026-07-14) |
| Target | `wasm32-wasip2` |
| `wasm-tools` | 1.255.0 |
| Environment | `testnet` (`https://cn-api.sg.testnet.t3n.terminal3.io`) |

Reference contract `z-tenant-flight` at commit fetched 2026-08-08. Note it
declares three different versions internally — README says v0.3.0, the WIT
package says 0.4.0, `Cargo.toml` says 0.4.1 (finding #10).

---

## Reproducing

### 1. Toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
rustup target add wasm32-wasip2
cargo install wasm-tools
```

### 2. Build the contract

```bash
git clone https://github.com/Terminal-3/z-tenant-flight.git
cd z-tenant-flight
cargo build --target wasm32-wasip2 --release
ls -lh target/wasm32-wasip2/release/*.wasm            # 194K
wasm-tools component wit target/wasm32-wasip2/release/z_tenant_flight.wasm
```

The component verifies clean: all five host imports present,
`export z:tenant-flight/contracts@0.4.0` exposed.

Tests need the host triple spelled out — the repo pins `wasm32-wasip2` as the
default target, so the documented `cargo test --lib` cannot execute (finding #5):

```bash
cargo test --lib --target x86_64-unknown-linux-gnu   # 7 passed
```

### 3. Node project

```bash
mkdir my-t3n-app && cd my-t3n-app
npm init -y && npm pkg set type=module
npm install @terminal3/t3n-sdk@4.25.0 tsx      # pinned: findings below are version-specific
export T3N_API_KEY="<key from the claim page>"
```

### 4. Run

```bash
npx tsx quickstart.ts

WASM_PATH=../z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm \
  npx tsx register.ts                          # prints the contract_id — keep it

CONTRACT_ID=<id from register> npx tsx invoke.ts
```

Scripts take `WASM_PATH`, `CONTRACT_ID`, `CONTRACT_TAIL`, `CONTRACT_VERSION` and
optionally `DUFFEL_API_KEY` from the environment; nothing is hardcoded to my
machine.

---

## What had to change versus the documented samples

The published samples **do not run as written**. Four edits were required, at
three different stages:

**Before the first authenticated call:**

1. `trustAnchor` had to be added to `new T3nClient({...})` — required by the
   type definitions, absent from every sample on the site (finding #1).
2. `fetchTrustedManifest("testnet")`, the documented way to get a real trust
   anchor, returns **405** from the testnet node, so `{ unsafe_trust_server: true }`
   is currently the only way through — i.e. the tutorial's only working path
   disables attestation verification (finding #2).

**After authentication, at the TenantClient step:**

3. `await tenant.me()` had to be removed — no such method exists in 4.25.0
   (finding #3).

**After the second registration, at invoke time:**

4. The `secrets` map ACL had to be re-issued against the new `contract_id`,
   because bumping the contract version mints a new id and silently orphans the
   old ACL (finding #8).

Full detail, severity and reproductions for all ten findings: [BUGS.md](BUGS.md).

---

## Files

```
scripts/quickstart.ts        authenticate, obtain tenant DID
scripts/register.ts          TenantClient + contract registration
scripts/invoke.ts            KV map, ACL, secret seeding, egress grant, contract call
logs/01-build.txt            cargo build + wasm-tools component wit
logs/02-quickstart.txt       authenticated session
logs/03-register.txt         contract registration
logs/04-invoke.txt           full invocation chain
logs/05-cargo-test.txt       documented test command failing + host-target fix
logs/06-acl-break.txt        reproduction of the ACL breakage (finding #8)
logs/07-stderr-volume.txt    2.13 MB stderr measurement (findings #1 and #7)
```

No credentials are committed: `T3N_API_KEY` and `DUFFEL_API_KEY` are read from
the environment. The tenant DID and the derived ETH address appear in the logs —
they are public testnet identifiers, published deliberately as proof of
completion.
