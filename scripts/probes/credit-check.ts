import { readFile } from "fs/promises";
import {
  T3nClient, TenantClient, setEnvironment, getNodeUrl,
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
const tenantDid = did.value;
const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

console.log("tenant DID:", tenantDid);
console.log("ETH address:", address);

// 1. что говорит getUsage
try {
  const usage = await (tenant.token as any).getUsage({});
  console.log("token.getUsage() ->", JSON.stringify(usage, null, 2).slice(0, 1500));
} catch (e: any) {
  try {
    const usage = await (tenant.token as any).getUsage();
    console.log("token.getUsage() ->", JSON.stringify(usage, null, 2).slice(0, 1500));
  } catch (e2: any) {
    console.log("token.getUsage() error:", e2?.message ?? String(e2));
  }
}

// 2. полный текст ошибки регистрации
const wasm = await readFile(process.env.WASM_PATH!);
try {
  const r = await tenant.contracts.register({
    tail: `cc${Date.now() % 100000}`,
    version: "0.1.0",
    wasm,
  });
  console.log("register OK ->", JSON.stringify(r));
} catch (e: any) {
  console.log("--- ПОЛНЫЙ ТЕКСТ ОШИБКИ РЕГИСТРАЦИИ ---");
  console.log(e?.message ?? String(e));
  if (e?.code) console.log("code:", e.code);
  if (e?.cause) console.log("cause:", JSON.stringify(e.cause).slice(0, 500));
}
