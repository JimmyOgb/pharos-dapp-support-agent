// src/config.ts
var NETWORKS = {
  pacific: {
    id: "pacific",
    name: "Pharos Pacific Mainnet",
    chainId: 1672,
    chainIdHex: "0x688",
    currency: "PROS",
    rpcUrl: process.env.PHAROS_PACIFIC_RPC || "https://rpc.pharos.xyz",
    explorerUrl: "https://pharosscan.xyz",
    txUrlTemplate: "https://pharosscan.xyz/tx/{hash}",
    isMainnet: true
  },
  atlantic: {
    id: "atlantic",
    name: "Pharos Atlantic Testnet",
    chainId: 688689,
    chainIdHex: "0xa8231",
    currency: "PHRS",
    rpcUrl: process.env.PHAROS_ATLANTIC_RPC || "https://atlantic.dplabs-internal.com",
    explorerUrl: "https://atlantic.pharosscan.xyz",
    txUrlTemplate: "https://atlantic.pharosscan.xyz/tx/{hash}",
    isMainnet: false
  }
};
var OFFICIAL_MCP_URL = process.env.PHAROS_MCP_URL || "https://mcp.pharos.xyz/mcp";
var DEFAULT_NETWORK_ID = process.env.DEFAULT_NETWORK || "pacific";

// src/mcp-client.ts
var ChainMcpClient = class {
  url;
  sessionId = null;
  cookie = null;
  msgId = 1;
  constructor(url = OFFICIAL_MCP_URL) {
    this.url = url;
  }
  parseSse(text) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        try {
          return JSON.parse(trimmed.slice(6));
        } catch {
        }
      }
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async initialize() {
    const initPayload = {
      jsonrpc: "2.0",
      id: this.msgId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "pharos-dapp-support-agent",
          version: "1.0.0"
        }
      }
    };
    const resp = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": "Mozilla/5.0 (compatible; PharosSupportAgent/1.0)"
      },
      body: JSON.stringify(initPayload)
    });
    if (!resp.ok) {
      throw new Error(`Failed to initialize Chain MCP session: HTTP ${resp.status} ${resp.statusText}`);
    }
    this.sessionId = resp.headers.get("mcp-session-id");
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }
    const bodyText = await resp.text();
    const parsed = this.parseSse(bodyText);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "Mozilla/5.0 (compatible; PharosSupportAgent/1.0)"
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.cookie) headers["Cookie"] = this.cookie;
    try {
      await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        })
      });
    } catch {
    }
    return parsed?.result || {};
  }
  async callTool(toolName, args, retry = true) {
    if (!this.sessionId) {
      await this.initialize();
    }
    const payload = {
      jsonrpc: "2.0",
      id: this.msgId++,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    };
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "Mozilla/5.0 (compatible; PharosSupportAgent/1.0)"
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.cookie) headers["Cookie"] = this.cookie;
    try {
      const resp = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        if ((resp.status === 400 || resp.status === 404 || resp.status === 401) && retry) {
          this.sessionId = null;
          await this.initialize();
          return this.callTool(toolName, args, false);
        }
        throw new Error(`Chain MCP tool call '${toolName}' failed: HTTP ${resp.status}`);
      }
      const bodyText = await resp.text();
      const parsed = this.parseSse(bodyText);
      if (!parsed) {
        throw new Error(`Chain MCP tool call '${toolName}' returned unparseable SSE body`);
      }
      if (parsed.error) {
        return { error: parsed.error };
      }
      const contentItem = parsed.result?.content?.[0];
      if (contentItem && contentItem.text) {
        try {
          return JSON.parse(contentItem.text);
        } catch {
          return contentItem.text;
        }
      }
      return parsed.result;
    } catch (err) {
      if (retry) {
        this.sessionId = null;
        try {
          await this.initialize();
          return await this.callTool(toolName, args, false);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }
  // Convenience methods matching official tool names
  async getTransaction(hash) {
    return this.callTool("get_transaction", { hash });
  }
  async getTransactionReceipt(hash) {
    return this.callTool("get_transaction_receipt", { hash });
  }
  async ethCall(transaction, block) {
    return this.callTool("eth_call", { transaction, block });
  }
  async getBalance(address, block) {
    return this.callTool("get_balance", { address, block });
  }
  async getCode(address, block) {
    return this.callTool("get_code", { address, block });
  }
  async getChainInfo() {
    return this.callTool("get_chain_info", {});
  }
};

// src/api/health.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  let mcpStatus = "UNKNOWN";
  let chainInfo = null;
  try {
    const client = new ChainMcpClient();
    chainInfo = await client.getChainInfo();
    mcpStatus = "ONLINE";
  } catch (err) {
    mcpStatus = `ERROR: ${err.message}`;
  }
  res.status(200).json({
    service: "Pharos dApp Support Agent",
    status: "HEALTHY",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    mcpUrl: OFFICIAL_MCP_URL,
    mcpStatus,
    chainInfo,
    supportedNetworks: Object.values(NETWORKS).map((n) => ({
      id: n.id,
      name: n.name,
      chainId: n.chainId,
      currency: n.currency,
      explorerUrl: n.explorerUrl
    }))
  });
}
export {
  handler as default
};
