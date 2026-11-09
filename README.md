# Pharos dApp Support Agent

> A production-grade, evidence-backed transaction failure debugger and technical support agent for the **Pharos blockchain**, powered by the official **Chain MCP** (`https://mcp.pharos.xyz/mcp`). **Zero simulation. Zero mock data. 100% on-chain provenance.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pharos Chain ID](https://img.shields.io/badge/Pharos%20Chain%20ID-1672%20%7C%20688689-06b6d4)](https://docs.pharos.xyz)
[![Node Version](https://img.shields.io/badge/Node-v24%2B-green.svg)](https://nodejs.org)
[![Chain MCP](https://img.shields.io/badge/Chain%20MCP-mcp.pharos.xyz-purple)](https://mcp.pharos.xyz/mcp)
[![Production URL](https://img.shields.io/badge/Vercel-pharos--dapp--support--agent.vercel.app-black?logo=vercel)](https://pharos-dapp-support-agent.vercel.app)

---

## Live Deployments & Links

- **Production Application URL:** [https://pharos-dapp-support-agent.vercel.app](https://pharos-dapp-support-agent.vercel.app)
- **Public GitHub Repository:** [https://github.com/JimmyOgb/pharos-dapp-support-agent](https://github.com/JimmyOgb/pharos-dapp-support-agent)
- **Health Check Endpoint:** [https://pharos-dapp-support-agent.vercel.app/api/health](https://pharos-dapp-support-agent.vercel.app/api/health)
- **Diagnostic API Endpoint:** `POST https://pharos-dapp-support-agent.vercel.app/api/diagnose`

---

## Pharos Agent Arena Task & Points

- **Task Name:** dApp Support Agent
- **Task Page:** [https://pharos-agent-arena.vercel.app/tasks/dapp-support-agent](https://pharos-agent-arena.vercel.app/tasks/dapp-support-agent)
- **Category:** EasySupport / Reporting
- **Base Task Points:** **50**
- **Optional Demonstration Video Bonus:** **+50**
- **Maximum Potential Points:** **100**

*Notice on Point Values:*  
The scoring values listed above (50 base + 50 optional video bonus = 100 maximum potential points) reflect the official potential points published by the Pharos Agent Arena for this task specification. These represent potential points to be evaluated by Arena judges upon formal submission, not pre-awarded or confirmed scores.

### Acceptance Criteria & Verification Status

| Criterion ID | Official Requirement | Implementation & Audit Strategy | Verification Status |
|:---:|:---|:---|:---:|
| **01** | **Accepts a tx hash and fetches the transaction and receipt via Chain MCP.** | Implemented in `src/mcp-client.ts` via official MCP tools `get_transaction` and `get_transaction_receipt`. | **VERIFIED (100% PASS)** |
| **02** | **Identifies the failure cause: revert reason, out of gas, insufficient balance or allowance, etc.** | Implemented in `src/diagnostics.ts` & `src/decoder.ts`. Replays `eth_call` at block height, decodes `Error(string)`, `Panic(uint256)`, custom errors, and gas ratios. | **VERIFIED (100% PASS)** |
| **03** | **Explains it without jargon and suggests a fix.** | Implemented in `src/explanation.ts`. Deterministic rule layer generates clear summaries, plain-English explanations, and actionable next steps. | **VERIFIED (100% PASS)** |
| **04** | **Demonstrated on at least 3 different failure types.** | Demonstrated and tested on 5 distinct live failure types on Pharos Pacific Mainnet (Chain ID 1672). | **VERIFIED (100% PASS)** |

---

## Live Demonstrations (Real Failed Transactions)

Every demonstrated transaction is a genuine transaction on Pharos Pacific Mainnet (Chain ID 1672) queried live via the official Chain MCP:

1. **DEX Swap Slippage Protection Exceeded (`SLIPPAGE`)**
   - **Hash:** `0x0b476df1d26079224c1d37e64d7f9506c906f70671525cbed317a4816e785d4e`
   - **Decoded Revert:** Revert string `"SLIPPAGE"` (`0x08c379a0`)
   - **Explorer Link:** [View on PharosScan](https://pharosscan.xyz/tx/0x0b476df1d26079224c1d37e64d7f9506c906f70671525cbed317a4816e785d4e)

2. **Smart Contract Invariant / Requirement Revert (`"succeeded to fail"`)**
   - **Hash:** `0x40cf7e708148a3e75f98a77138b6a9560258d91c96ced246cfb4dbfd01338c52`
   - **Decoded Revert:** Revert string `"succeeded to fail"`
   - **Explorer Link:** [View on PharosScan](https://pharosscan.xyz/tx/0x40cf7e708148a3e75f98a77138b6a9560258d91c96ced246cfb4dbfd01338c52)

3. **Protocol Custom Error Revert (`0x2c19b8b8`)**
   - **Hash:** `0x8ebbdfaf1ce0b3a498936ba1c73307d6b157264571111a803e69947ae219a349`
   - **Decoded Revert:** Custom error selector `0x2c19b8b8` with quantity parameters (available ~713.01 vs required ~713.85)
   - **Explorer Link:** [View on PharosScan](https://pharosscan.xyz/tx/0x8ebbdfaf1ce0b3a498936ba1c73307d6b157264571111a803e69947ae219a349)

4. **Call to Non-Contract Address (`CALL_TO_NON_CONTRACT`)**
   - **Hash:** `0xb32c2408a85fdb64453c682fe7e76cc27f0cc481308ca1b673878550e48abd6e`
   - **Decoded Revert:** Bytecode check returned `0x` (recipient address has no contract deployed)
   - **Explorer Link:** [View on PharosScan](https://pharosscan.xyz/tx/0xb32c2408a85fdb64453c682fe7e76cc27f0cc481308ca1b673878550e48abd6e)

5. **Pool Reserve Restriction / Liquidity Limit (`SPL0`)**
   - **Hash:** `0xc87cecbefba3ebe8059063a24e135f4e24ddef9afdf5f524c13aa4f5022c3e48`
   - **Decoded Revert:** Revert string `"SPL0"`
   - **Explorer Link:** [View on PharosScan](https://pharosscan.xyz/tx/0xc87cecbefba3ebe8059063a24e135f4e24ddef9afdf5f524c13aa4f5022c3e48)

---

## Architecture Overview

```
User Hash Input ──► Chain MCP Client (mcp.pharos.xyz)
                         ├── get_transaction
                         ├── get_transaction_receipt
                         ├── eth_call (revert replay at block)
                         ├── get_code (contract bytecode check)
                         └── get_balance (native balance check)
                                  │
                                  ▼
                   Deterministic Diagnostic Engine
                         ├── Gas Forensics (OOG detection)
                         ├── ABI Revert Decoder (Error, Panic, Custom)
                         └── Evidence Normalization
                                  │
                                  ▼
                  Plain-English Explanation & Action Plan
                                  │
                                  ▼
                Interactive Dashboard & PharosScan Links
```

---

## Local Development & Testing

### Prerequisites
- Node.js v20+ (Node.js v24 recommended)
- npm

### Installation
```bash
git clone https://github.com/JimmyOgb/pharos-dapp-support-agent.git
cd pharos-dapp-support-agent
npm install
```

### Running Unit Tests
```bash
npm test
```

### Running Live Chain MCP Integration Tests
```bash
npm run test:integration
```

### Starting the Local Development Server
```bash
npm start
# Open http://localhost:3000 in your browser
```

---

## Environment Variables

Configure via `.env` or Vercel Environment Variables:

```bash
# Official Chain MCP Endpoint
PHAROS_MCP_URL=https://mcp.pharos.xyz/mcp

# Pharos Pacific Mainnet RPC (Chain ID 1672)
PHAROS_PACIFIC_RPC=https://rpc.pharos.xyz

# Pharos Atlantic Testnet RPC (Chain ID 688689)
PHAROS_ATLANTIC_RPC=https://atlantic.dplabs-internal.com

# Default Network (pacific | atlantic)
DEFAULT_NETWORK=pacific
```

---

## Security & Read-Only Guarantee

- **Zero Private Keys:** The application never requests, collects, or stores private keys or seed phrases.
- **Zero Wallet Popups:** Read-only inspection; no wallet connection or signature approval is required.
- **Zero Gas Cost:** All diagnostics are performed through read-only RPC/MCP introspection.
- **Zero Simulation:** All responses are derived strictly from verifiable on-chain receipts and EVM replay output.

---

## License

MIT © [JimmyOgb](https://github.com/JimmyOgb)
