// Probe for finding #11: which version strings does contracts.register() accept,
// and which of those can actually be invoked afterwards?
import { readFile } from "fs/promises";
import {
  T3nClient, TenantClient, setEnvironment, getNodeUrl, getScriptVersion,
  loadWasmComponent, eth_get_address, metamask_sign, createEthAuthInput,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");
const KEY = process.env.T3N_API_KEY!;
const WASM = process.env.WASM_PATH!;
const TAIL = "probe";

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

// ascending so each register is "higher" than the last
const candidates = ["0.0.1", "0.0.99", "0.1.100", "0.1.999", "0.2.1000", "0.3.1647", "1.220.1647"];

for (const version of candidates) {
  let registered = false;
  try {
    await tenant.contracts.register({ tail: TAIL, version, wasm });
    registered = true;
  } catch (e: any) {
    console.log(`${version.padEnd(12)} register: REJECTED — ${(e?.message ?? e).slice(0, 90)}`);
    continue;
  }
  // registered fine — can it be resolved and invoked?
  try {
    const v = await getScriptVersion(getNodeUrl(), SCRIPT);
    await t3n.executeAndDecode({
      script_name: SCRIPT, script_version: v,
      function_name: "search-offers",
      input: { origin: "IST", destination: "BEG", departure_date: "2026-08-26", cabin_class: "economy", adult_count: 1 },
    });
    console.log(`${version.padEnd(12)} register: OK   invoke: OK (reached contract)`);
  } catch (e: any) {
    const m = (e?.message ?? String(e));
    const semverIssue = m.includes("Invalid semver");
    console.log(`${version.padEnd(12)} register: OK   invoke: ${semverIssue ? "*** SEMVER REJECTED ***" : "reached contract"} — ${m.slice(0, 80)}`);
  }
}
