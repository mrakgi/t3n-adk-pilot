// One version per run — deliberately not a loop.
//
// Finding #12 left one question open: which component of "2.220.1647" the
// invoke-side parser rejects, given that "1.220.1647" and "0.3.1647" both
// register AND invoke cleanly. Each probe costs ~189 tokens to register plus
// 10 000 to invoke, so a seven-candidate sweep is not affordable — this script
// tests exactly one candidate and stops.
//
//   PROBE_VERSION=2.0.0 PROBE_TAIL=probe2 npx tsx semver-one.ts
//
// Reading the result:
//   register REJECTED + InsufficientCredit -> no credit was spent; the error
//                                             reports the exact balance
//   invoke "Invalid semver format"         -> the invoke-side parser refuses it
//   invoke fails inside the contract       -> the version got that far; the
//     (e.g. kv_store read denied, #8)         request passed validation
//   invoke fails any other way             -> inconclusive: a network, auth or
//                                             credit error can precede the
//                                             version check
import { readFile } from "fs/promises";
import {
  T3nClient, TenantClient, setEnvironment, getNodeUrl, getScriptVersion,
  loadWasmComponent, eth_get_address, metamask_sign, createEthAuthInput,
} from "@terminal3/t3n-sdk";

const VERSION = process.env.PROBE_VERSION!;
const TAIL = process.env.PROBE_TAIL ?? "probe2";
const KEY = process.env.T3N_API_KEY!;
const WASM = process.env.WASM_PATH!;

if (!VERSION) { console.error("set PROBE_VERSION"); process.exit(1); }

const short = (e: any) => {
  const m = e?.message ?? String(e);
  return m.length > 600 ? m.slice(0, 600) + " …[truncated]" : m;
};

setEnvironment("testnet");
const wasmComponent = await loadWasmComponent();
const address = eth_get_address(KEY);
const t3n = new T3nClient({
  wasmComponent,
  trustAnchor: { unsafe_trust_server: true },
  handlers: { EthSign: metamask_sign(address, undefined, KEY) },
});
await t3n.handshake();
const did = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = did.value;
const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });
const wasm = await readFile(WASM);
const SCRIPT = `z:${tenantDid.slice("did:t3n:".length)}:${TAIL}`;

console.log(`probe    : version=${VERSION} tail=${TAIL}`);
console.log(`script   : ${SCRIPT}`);
console.log(`utc      : ${new Date().toISOString()}`);
console.log("---");

// 1. register
let contractId: unknown;
try {
  const r = await tenant.contracts.register({ tail: TAIL, version: VERSION, wasm });
  contractId = (r as any)?.contract_id ?? r;
  console.log(`register : OK  -> ${JSON.stringify(contractId)}`);
} catch (e: any) {
  console.log(`register : REJECTED`);
  console.log(short(e));
  console.log("--- stopping: nothing was invoked, so no 10 000-token call was made ---");
  process.exit(0);
}

// 2. what does the node now consider latest?
let resolved: string | undefined;
try {
  resolved = await getScriptVersion(getNodeUrl(), SCRIPT);
  console.log(`latest   : getScriptVersion() -> ${resolved}`);
  if (resolved !== VERSION) {
    console.log(`WARNING  : latest is not the version just registered — this tail`);
    console.log(`           already carries a higher version, so the invoke below`);
    console.log(`           does NOT test ${VERSION}. Use a fresh PROBE_TAIL.`);
  }
} catch (e: any) {
  console.log(`latest   : getScriptVersion() failed — ${short(e)}`);
}

// 3. invoke the version we just registered
try {
  const out = await t3n.executeAndDecode({
    script_name: SCRIPT,
    script_version: resolved ?? VERSION,
    function_name: "search-offers",
    input: {
      origin: "IST", destination: "BEG", departure_date: "2026-08-26",
      cabin_class: "economy", adult_count: 1,
    },
  });
  console.log(`invoke   : OK — reached contract`);
  console.log(JSON.stringify(out).slice(0, 400));
} catch (e: any) {
  const m = short(e);
  let verdict: string;
  if (m.includes("Invalid semver")) {
    verdict = "*** SEMVER REJECTED ***";
  } else if (m.includes("contract error")) {
    // the contract runtime answered, so the request cleared validation
    verdict = "version accepted — failed inside the contract";
  } else {
    verdict = "inconclusive — failed before reaching contract code";
  }
  console.log(`invoke   : ${verdict}`);
  console.log(m);
}
