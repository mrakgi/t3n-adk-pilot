import {
  T3nClient,
  TenantClient,
  setEnvironment,
  getNodeUrl,
  getScriptVersion,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet"); // see BUGS.md #9 on the documented default

const T3N_API_KEY = process.env.T3N_API_KEY;
if (!T3N_API_KEY) throw new Error("T3N_API_KEY is not set in the environment");

// The contract_id returned by register.ts. Map ACLs are bound to this exact id.
const CONTRACT_ID = Number(process.env.CONTRACT_ID);
if (!Number.isFinite(CONTRACT_ID)) throw new Error("CONTRACT_ID is not set");

const TAIL = process.env.CONTRACT_TAIL ?? "flight";

// No Duffel account was created for this exercise: without DUFFEL_API_KEY the
// placeholder below is seeded, and Duffel is expected to answer HTTP 401.
// That is the intended end state — it proves the T3N side of the chain works.
const DUFFEL_KEY = process.env.DUFFEL_API_KEY ?? "duffel_test_PLACEHOLDER";
console.log(
  process.env.DUFFEL_API_KEY
    ? "seeding real DUFFEL_API_KEY from the environment"
    : `seeding placeholder "${DUFFEL_KEY}" — Duffel is expected to reject it with 401`,
);

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
console.log("tenant:", tenantDid);

const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

// --- step 1: the secrets map (idempotent) ---
try {
  await tenant.maps.create({
    tail: "secrets",
    visibility: "private",
    writers: { only: [CONTRACT_ID] },
    readers: { only: [CONTRACT_ID] }, // required — the kv governor defaults to deny
  });
  console.log("map z:<tid>:secrets created");
} catch (e: any) {
  console.log("maps.create:", e?.message ?? String(e));
}

// BUGS.md #8: re-registering the same tail mints a NEW contract_id while the map
//   ACL still names the old one, and the contract loses access to its own
//   secrets ("access denied: TenantContract(<did>/<id>) cannot read map ...").
//   The walkthrough never mentions re-issuing the ACL. See logs/06-acl-break.txt.
try {
  await tenant.maps.update("secrets", {
    writers: { only: [CONTRACT_ID] },
    readers: { only: [CONTRACT_ID] },
  });
  console.log(`secrets ACL re-issued for contract_id ${CONTRACT_ID}`);
} catch (e: any) {
  console.log("maps.update:", e?.message ?? String(e));
}

// --- step 2: seed the key through the control plane (bypasses the writers ACL) ---
try {
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key: "duffel_api_key",
    value: DUFFEL_KEY,
  });
  console.log("key sealed into z:<tid>:secrets");
} catch (e: any) {
  console.log("map-entry-set:", e?.message ?? String(e));
}

// --- step 3: self-grant egress to api.duffel.com ---
// Allowed hosts come from the calling user's grant, not from the contract.
const TENANT_SCRIPT = `z:${tenantDid.slice("did:t3n:".length)}:${TAIL}`;
const latestVersion = await getScriptVersion(getNodeUrl(), TENANT_SCRIPT);

// BUGS.md #12/#13: "latest" can resolve to a version the invoke path refuses to
//   parse. Set CONTRACT_VERSION to pin an older, known-good one instead — that
//   pin does work, despite the docs warning that it is ignored.
const scriptVersion = process.env.CONTRACT_VERSION ?? latestVersion;
console.log(
  "script:", TENANT_SCRIPT,
  "| latest reported:", latestVersion,
  process.env.CONTRACT_VERSION ? `| pinned to: ${scriptVersion}` : "| using latest",
);

try {
  const userContractVersion = await getScriptVersion(getNodeUrl(), "tee:user/contracts");
  await t3n.execute({
    script_name: "tee:user/contracts",
    script_version: userContractVersion,
    function_name: "agent-auth-update",
    input: {
      agents: [
        {
          agentDid: tenantDid, // self-grant: calling directly, no separate agent identity
          scripts: [
            {
              scriptName: TENANT_SCRIPT,
              versionReq: scriptVersion,
              functions: ["search-offers", "book-offer"],
              allowedHosts: ["api.duffel.com"],
            },
          ],
        },
      ],
    },
  });
  console.log("egress grant issued (self)");
} catch (e: any) {
  console.log("agent-auth-update:", e?.message ?? String(e));
}

// --- step 4: call the contract in the network ---
try {
  const res = await t3n.executeAndDecode({
    script_name: TENANT_SCRIPT,
    script_version: scriptVersion,
    function_name: "search-offers",
    input: {
      origin: "IST",
      destination: "BEG",
      departure_date: "2026-08-26",
      cabin_class: "economy",
      adult_count: 1,
    },
  });
  console.log("CONTRACT RESPONSE:", JSON.stringify(res).slice(0, 600));
} catch (e: any) {
  // Reaching Duffel at all means: enclave execution + KV secret read + authorised
  // egress all succeeded. A 401 here is the third-party rejecting the placeholder.
  console.log("CALL RETURNED:", e?.message ?? String(e));
}
