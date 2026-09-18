import { BlockList, isIP } from "node:net";

import { Option } from "effect";

import type { TrustedProxyConfig } from "../config";

// ---------------------------------------------------------------------------
// Client IP for Better Auth's rate limiter.
//
// Better Auth only reads the client IP from request headers. Nothing tells it
// which TCP peer the request came from, so on a directly exposed self-host it
// found no header, logged a warning, and pooled every caller into one bucket of
// three sign-ins per ten seconds. The fix has two halves:
//
//   1. The server stamps the socket peer address onto CLIENT_IP_HEADER before
//      Better Auth sees the request, always overwriting anything the client
//      sent. A direct client can only ever rate-limit itself.
//   2. Behind a reverse proxy the peer is the proxy, so the operator names the
//      header the proxy sets (EXECUTOR_TRUSTED_PROXY_HEADER) and the addresses
//      it connects from (EXECUTOR_TRUSTED_PROXIES). That header is honoured only
//      on connections from one of those addresses and stripped otherwise, so a
//      client that reaches the container directly cannot assert a proxy header.
// ---------------------------------------------------------------------------

/** Server-stamped socket peer address. Never trusted from the client. */
export const CLIENT_IP_HEADER = "x-executor-client-ip";

export interface IpRange {
  readonly address: string;
  readonly prefix: number;
  readonly family: "ipv4" | "ipv6";
}

/**
 * Parse an IP address or `address/prefix` CIDR range. `undefined` for anything
 * else, so a typo cannot silently become a non-matching (or all-matching) rule.
 */
export const parseIpRange = (value: string): IpRange | undefined => {
  const slash = value.indexOf("/");
  const address = slash === -1 ? value : value.slice(0, slash);
  const version = isIP(address);
  if (version === 0) return undefined;
  const family = version === 6 ? "ipv6" : "ipv4";
  const maxPrefix = version === 6 ? 128 : 32;
  if (slash === -1) return { address, prefix: maxPrefix, family };
  const prefixText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return undefined;
  const prefix = Number(prefixText);
  if (prefix > maxPrefix) return undefined;
  return { address, prefix, family };
};

const blockListOf = (ranges: readonly IpRange[]): BlockList => {
  const list = new BlockList();
  for (const range of ranges) list.addSubnet(range.address, range.prefix, range.family);
  return list;
};

// `isIP` rejects the `::ffff:` prefix form only when malformed; a dual-stack
// socket may report an IPv4 peer as an IPv4-mapped IPv6 address, which
// BlockList matches against IPv4 rules on its own.
const isTrustedPeer = (list: BlockList, address: string): boolean => {
  const version = isIP(address);
  return version !== 0 && list.check(address, version === 6 ? "ipv6" : "ipv4");
};

/**
 * Header names Better Auth walks, in order, to find the client IP. The proxy's
 * header leads when one is configured; the server-stamped socket address is the
 * fallback for requests that did not come through the proxy.
 */
export const clientIpHeaders = (trustedProxy: TrustedProxyConfig | undefined): string[] =>
  trustedProxy ? [trustedProxy.header, CLIENT_IP_HEADER] : [CLIENT_IP_HEADER];

/**
 * Build the per-request rewrite that stamps the socket peer address onto
 * CLIENT_IP_HEADER (or removes it when the runtime cannot report one) and
 * drops the trusted-proxy header unless the peer is a configured proxy. The
 * `remoteAddress` is the TCP peer as reported by the HTTP server, not anything
 * read from the request.
 */
export const makeClientIpStamper = (
  trustedProxy: TrustedProxyConfig | undefined,
): ((request: Request, remoteAddress: Option.Option<string>) => Request) => {
  const proxies = trustedProxy
    ? blockListOf(trustedProxy.proxies.flatMap((entry) => parseIpRange(entry) ?? []))
    : undefined;
  return (request, remoteAddress) => {
    const headers = new Headers(request.headers);
    const peer = Option.getOrUndefined(remoteAddress);
    if (peer) {
      headers.set(CLIENT_IP_HEADER, peer);
    } else {
      headers.delete(CLIENT_IP_HEADER);
    }
    if (trustedProxy && proxies && !(peer && isTrustedPeer(proxies, peer))) {
      headers.delete(trustedProxy.header);
    }
    return new Request(request, { headers });
  };
};
