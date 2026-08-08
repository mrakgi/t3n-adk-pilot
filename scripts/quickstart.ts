import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";

// Set explicitly for clarity. Note the Quickstart claims the SDK "defaults to
// production"; in 4.25.0 DEFAULT_ENVIRONMENT is actually "testnet" — see BUGS.md #9.
setEnvironment("testnet");

const T3N_API_KEY = process.env.T3N_API_KEY;
if (!T3N_API_KEY) throw new Error("T3N_API_KEY is not set in the environment");

const wasmComponent = await loadWasmComponent(); // all crypto runs inside this component
const address = eth_get_address(T3N_API_KEY);
console.log("ETH address:", address);

// BUGS.md #1: `trustAnchor` is a required field of T3nClientConfig, but no
//   sample on the docs site passes it — omitting it makes handshake() die with
//   "TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')".
// BUGS.md #2: the documented way to obtain a real anchor,
//   fetchTrustedManifest("testnet"), fails against the testnet node with
//   HTTP 405, so the explicit dev opt-out below is currently the only way through.
const t3n = new T3nClient({
  wasmComponent,
  trustAnchor: { unsafe_trust_server: true }, // deliberate dev opt-out — NOT for production
  handlers: {
    EthSign: metamask_sign(address, undefined, T3N_API_KEY),
  },
});

await t3n.handshake();
console.log("handshake: ok");

const did = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = did.value; // read from the session — never hardcode or derive it

console.log("Connected as:", tenantDid);
