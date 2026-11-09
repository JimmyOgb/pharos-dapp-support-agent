import { ChainMcpClient } from '../mcp-client.ts';
import { NETWORKS, OFFICIAL_MCP_URL } from '../config.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  let mcpStatus = 'UNKNOWN';
  let chainInfo = null;

  try {
    const client = new ChainMcpClient();
    chainInfo = await client.getChainInfo();
    mcpStatus = 'ONLINE';
  } catch (err: any) {
    mcpStatus = `ERROR: ${err.message}`;
  }

  res.status(200).json({
    service: 'Pharos dApp Support Agent',
    status: 'HEALTHY',
    timestamp: new Date().toISOString(),
    mcpUrl: OFFICIAL_MCP_URL,
    mcpStatus,
    chainInfo,
    supportedNetworks: Object.values(NETWORKS).map((n) => ({
      id: n.id,
      name: n.name,
      chainId: n.chainId,
      currency: n.currency,
      explorerUrl: n.explorerUrl,
    })),
  });
}
