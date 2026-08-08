import { readFile } from "fs/promises";
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  getNodeUrl,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet"); // see BUGS.md #9 on the documented default

const T3N_API_KEY = process.env.T3N_API_KEY;
if (!T3N_API_KEY) throw new Error("T3N_API_KEY is not set in the environment");

// Path to the .wasm produced by `cargo build --target wasm32-wasip2 --release`
// inside the cloned z-tenant-flight repo. Override with WASM_PATH.
const WASM_PATH =
  process.env.WASM_PATH ??
  "../z-tenant-flight/target/wasm32-wasip2/release/z_tenant_flight.wasm";

const CONTRACT_TAIL = process.env.CONTRACT_TAIL ?? "flight"; // short tail — long ones hit limits downstream
const CONTRACT_VERSION = process.env.CONTRACT_VERSION ?? "0.1.0";

const wasmComponent = await loadWasmComponent();
const address = eth_get_address(T3N_API_KEY);

const t3n = new T3nClient({
  wasmComponent,
  trustAnchor: { unsafe_trust_server: true }, // see BUGS.md #1 and #2
  handlers: { EthSign: metamask_sign(address, undefined, T3N_API_KEY) },
});

await t3n.handshake();
const did = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = did.value;
console.log("Connected as:", tenantDid);

// baseUrl is passed explicitly: the docs' own Common errors page warns that
// TenantClient can fail at request time without it, even after setEnvironment().
const tenant = new TenantClient({
  t3n,
  baseUrl: getNodeUrl(),
  tenantDid,
});

// BUGS.md #3: the docs suggest `await tenant.me()` here as the check that the
//   client works, but no such method exists in SDK 4.25.0. Using what does exist.
// BUGS.md #6: getEnvironment() returns undefined unless `environment` was passed
//   into the config — module-level setEnvironment() is not inherited.
console.log("TenantClient env:", tenant.getEnvironment());
console.log("TenantClient canonical:", tenant.canonicalName(CONTRACT_TAIL));

const wasmBytes = await readFile(WASM_PATH);
console.log(`wasm: ${WASM_PATH} (${wasmBytes.length} bytes)`);

const result = await tenant.contracts.register({
  tail: CONTRACT_TAIL,
  version: CONTRACT_VERSION,
  wasm: wasmBytes,
});

const contractId = result.contract_id;
const scriptName = `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;

console.log(`registered ${scriptName} as contract id ${contractId}`);
console.log("RESULT_JSON:", JSON.stringify(result));
// Keep this id: map ACLs are bound to it, and re-registering mints a new one (BUGS.md #8).
