import { OFFICIAL_MCP_URL } from './config.ts';

export interface McpToolCallResponse {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class ChainMcpClient {
  private url: string;
  private sessionId: string | null = null;
  private cookie: string | null = null;
  private msgId = 1;

  constructor(url: string = OFFICIAL_MCP_URL) {
    this.url = url;
  }

  private parseSse(text: string): any {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        try {
          return JSON.parse(trimmed.slice(6));
        } catch {
          // ignore parse error on partial lines
        }
      }
    }
    // Also try direct JSON parse if server returned raw application/json
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  public async initialize(): Promise<{ serverInfo?: any; capabilities?: any }> {
    const initPayload = {
      jsonrpc: '2.0',
      id: this.msgId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'pharos-dapp-support-agent',
          version: '1.0.0',
        },
      },
    };

    const resp = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': 'Mozilla/5.0 (compatible; PharosSupportAgent/1.0)',
      },
      body: JSON.stringify(initPayload),
    });

    if (!resp.ok) {
      throw new Error(`Failed to initialize Chain MCP session: HTTP ${resp.status} ${resp.statusText}`);
    }

    this.sessionId = resp.headers.get('mcp-session-id');
    const setCookie = resp.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }

    const bodyText = await resp.text();
    const parsed = this.parseSse(bodyText);

    // Send initialized notification
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'Mozilla/5.0 (compatible; PharosSupportAgent/1.0)',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.cookie) headers['Cookie'] = this.cookie;

    try {
      await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
    } catch {
      // non-fatal if notification response is empty
    }

    return parsed?.result || {};
  }

  public async callTool(toolName: string, args: Record<string, any>, retry = true): Promise<any> {
    if (!this.sessionId) {
      await this.initialize();
    }

    const payload = {
      jsonrpc: '2.0',
      id: this.msgId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'Mozilla/5.0 (compatible; PharosSupportAgent/1.0)',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.cookie) headers['Cookie'] = this.cookie;

    try {
      const resp = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
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
    } catch (err: any) {
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
  public async getTransaction(hash: string): Promise<any> {
    return this.callTool('get_transaction', { hash });
  }

  public async getTransactionReceipt(hash: string): Promise<any> {
    return this.callTool('get_transaction_receipt', { hash });
  }

  public async ethCall(transaction: Record<string, any>, block?: string | number): Promise<any> {
    return this.callTool('eth_call', { transaction, block });
  }

  public async getBalance(address: string, block?: string | number): Promise<any> {
    return this.callTool('get_balance', { address, block });
  }

  public async getCode(address: string, block?: string | number): Promise<any> {
    return this.callTool('get_code', { address, block });
  }

  public async getChainInfo(): Promise<any> {
    return this.callTool('get_chain_info', {});
  }
}
