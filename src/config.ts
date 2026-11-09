import type { NetworkConfig, NetworkId } from './types.ts';

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  pacific: {
    id: 'pacific',
    name: 'Pharos Pacific Mainnet',
    chainId: 1672,
    chainIdHex: '0x688',
    currency: 'PROS',
    rpcUrl: process.env.PHAROS_PACIFIC_RPC || 'https://rpc.pharos.xyz',
    explorerUrl: 'https://pharosscan.xyz',
    txUrlTemplate: 'https://pharosscan.xyz/tx/{hash}',
    isMainnet: true,
  },
  atlantic: {
    id: 'atlantic',
    name: 'Pharos Atlantic Testnet',
    chainId: 688689,
    chainIdHex: '0xa8231',
    currency: 'PHRS',
    rpcUrl: process.env.PHAROS_ATLANTIC_RPC || 'https://atlantic.dplabs-internal.com',
    explorerUrl: 'https://atlantic.pharosscan.xyz',
    txUrlTemplate: 'https://atlantic.pharosscan.xyz/tx/{hash}',
    isMainnet: false,
  },
};

export const OFFICIAL_MCP_URL = process.env.PHAROS_MCP_URL || 'https://mcp.pharos.xyz/mcp';
export const DEFAULT_NETWORK_ID: NetworkId = (process.env.DEFAULT_NETWORK as NetworkId) || 'pacific';

export function getNetwork(networkId?: string): NetworkConfig {
  if (networkId && networkId.toLowerCase() in NETWORKS) {
    return NETWORKS[networkId.toLowerCase() as NetworkId];
  }
  return NETWORKS[DEFAULT_NETWORK_ID];
}
