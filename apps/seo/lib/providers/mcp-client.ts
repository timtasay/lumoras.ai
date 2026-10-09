/**
 * A minimal MCP client over Streamable HTTP, enough to call tools on an
 * OpenSEO server (docs/openseo-tools.md). No SDK dependency: the protocol we
 * need is three JSON-RPC methods over POST.
 *
 * OpenSEO serves MCP statelessly (no session; `subscriptions/listen` is
 * refused). Each request carries the 2026-07-28 protocol's per-request
 * `_meta` claim (protocol version and client capabilities) and the
 * `Mcp-Method` / `Mcp-Name` headers, so no `initialize` round trip is needed;
 * servers on older protocol versions route the same body through their
 * stateless JSON fallback. Responses may be `application/json` or a short
 * `text/event-stream`; both are read.
 *
 * Tool output is untrusted data. Only `structuredContent` is returned; the
 * free-text `content` (which an LLM might read as instructions) is ignored
 * except to build an error message, truncated.
 */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

export class McpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export type McpClientOptions = {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

type JsonRpcResponse = { jsonrpc: "2.0"; id: number | string | null; result?: Record<string, unknown>; error?: { code: number; message: string } };

/** Reads the JSON-RPC message with this id from an SSE body ("event: message\ndata: {...}\n\n"). */
export function parseSse(body: string, id: number): JsonRpcResponse | null {
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const msg = JSON.parse(data) as JsonRpcResponse;
      if (msg && msg.id === id) return msg;
    } catch {
      // not JSON: ignore the block
    }
  }
  return null;
}

export class McpClient {
  private seq = 0;
  constructor(private readonly o: McpClientOptions) {
    const u = new URL(o.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new McpError("MCP URL must be http(s)");
    if (u.username || u.password) throw new McpError("put MCP credentials in headers, not in the URL");
  }

  private async rpc(method: string, params: Record<string, unknown>, name?: string): Promise<Record<string, unknown>> {
    const id = ++this.seq;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(this.o.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          "Mcp-Method": method,
          ...(name ? { "Mcp-Name": name } : {}),
          ...this.o.headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION, "io.modelcontextprotocol/clientCapabilities": {} } },
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
        redirect: "error",
      });
    } catch (e) {
      throw new McpError(`MCP ${method} failed: ${e instanceof Error ? e.name : "network error"}`);
    }
    const text = await res.text();
    if (text.length > 20_000_000) throw new McpError(`MCP ${method}: response too large`);
    if (!res.ok) throw new McpError(`MCP ${method}: HTTP ${res.status} ${text.slice(0, 160)}`, res.status);
    let msg: JsonRpcResponse | null;
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) msg = parseSse(text, id);
    else {
      try {
        msg = JSON.parse(text) as JsonRpcResponse;
      } catch {
        throw new McpError(`MCP ${method}: the server did not answer with JSON`);
      }
    }
    if (!msg || msg.id !== id) throw new McpError(`MCP ${method}: no response for request ${id}`);
    if (msg.error) throw new McpError(`MCP ${method}: ${msg.error.code} ${String(msg.error.message).slice(0, 200)}`);
    return msg.result ?? {};
  }

  /** tools/list: the server's tool names (for the admin status check). */
  async listTools(): Promise<string[]> {
    const r = await this.rpc("tools/list", {});
    return (Array.isArray(r.tools) ? r.tools : []).map((t) => String((t as { name?: unknown }).name ?? "")).filter(Boolean);
  }

  /** tools/call: returns structuredContent; a tool error becomes an McpError. */
  async callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
    const r = await this.rpc("tools/call", { name, arguments: args }, name);
    if (r.isError) {
      const first = Array.isArray(r.content) ? (r.content[0] as { text?: unknown } | undefined) : undefined;
      throw new McpError(`${name}: ${String(first?.text ?? "tool error").slice(0, 300)}`);
    }
    if (!r.structuredContent || typeof r.structuredContent !== "object") throw new McpError(`${name}: no structuredContent in the result`);
    return r.structuredContent as T;
  }
}
