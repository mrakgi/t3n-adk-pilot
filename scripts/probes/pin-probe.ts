// Does explicitly pinning an older, known-good version bypass the broken
// "latest" version? The docs warn that invocations route to the latest
// registered version even when an older one is passed. Testing that directly.
import {
  T3nClient, setEnvironment, getNodeUrl, getScriptVersion,
  loadWasmComponent, eth_get_address, metamask_sign, createEthAuthInput,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");
const KEY = process.env.T3N_API_KEY!;
const wasmComponent = await loadWasmComponent();
const address = eth_get_address(KEY);
const t3n = new T3nClient({
  wasmComponent,
  trustAnchor: { unsafe_trust_server: true },
  handlers: { EthSign: metamask_sign(address, undefined, KEY) },
});
await t3n.handshake();
const did = await t3n.authenticate(createEthAuthInput(address));
const tid = did.value.slice("did:t3n:".length);
const SCRIPT = `z:${tid}:flight`;

const latest = await getScriptVersion(getNodeUrl(), SCRIPT);
console.log("getScriptVersion() reports:", latest);

const input = { origin: "IST", destination: "BEG", departure_date: "2026-08-26", cabin_class: "economy", adult_count: 1 };

for (const v of [latest, "0.2.0", "0.1.3", "0.1.0"]) {
  try {
    await t3n.executeAndDecode({ script_name: SCRIPT, script_version: v, function_name: "search-offers", input });
    console.log(`version ${String(v).padEnd(12)} -> OK`);
  } catch (e: any) {
    const m = e?.message ?? String(e);
    const verdict =
      m.includes("Invalid semver") ? "*** rejected: invalid semver ***" :
      m.includes("Duffel")         ? "reached contract + egress (full chain works)" :
      m.includes("access denied")  ? "reached contract, ACL denied" :
      m.slice(0, 70);
    console.log(`version ${String(v).padEnd(12)} -> ${verdict}`);
  }
}
