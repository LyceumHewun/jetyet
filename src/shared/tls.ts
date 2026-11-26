export const DEFAULT_HYSTERIA_VERSION = "v2.14.0";
export const DEFAULT_TLS_SNI = "bing.com";
export const DEFAULT_ECH_PUBLIC_NAME = "cloudflare-ech.com";
export const MIN_PINNED_TLS_VERSION = "v2.6.4";
export const MIN_BBR_VERSION = "v2.8.0";
export const MIN_ECH_VERSION = "v2.12.3";

export type TlsSecurityMode = "legacy" | "pinned";

const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isValidDnsName(value: string) {
  if (
    !value ||
    value.length > 253 ||
    !value.includes(".") ||
    value.includes(":") ||
    ipv4Pattern.test(value)
  )
    return false;
  return value.split(".").every((label) => dnsLabelPattern.test(label));
}

export function compareHysteriaVersion(a: string, b: string) {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
