import type { Entity, Store } from "./db";

export const subscriptionFormats = [
  "mihomo",
  "sing-box",
  "shadowrocket",
] as const;
export type SubscriptionFormat = (typeof subscriptionFormats)[number];

export function clientFormat(agent: string): SubscriptionFormat | undefined {
  if (
    /^(?:mihomo|clash(?:[ .-]?(?:meta|verge))?|flclash)(?:[ /_-]|$)/i.test(
      agent,
    )
  )
    return "mihomo";
  if (/^(?:sing-box|sfa|sfi|sfm|sft|sfd)(?:[ /_-]|$)/i.test(agent))
    return "sing-box";
  if (/^shadowrocket(?:[ /_-]|$)/i.test(agent)) return "shadowrocket";
}

export function subscriptionLink(s: Store, user: Entity) {
  return `${s.config.origin}/sub/${s.secrets(user.id).subscriptionToken}`;
}

export function formatLinks(base: string) {
  return {
    mihomo: `${base}?format=mihomo`,
    "sing-box": `${base}?format=sing-box`,
    shadowrocket: `${base}?format=shadowrocket`,
  };
}

export function subscriptionNodes(s: Store, user: Entity) {
  return s.list("node").filter((node) => {
    if (
      !user.nodeIds.includes(node.id) ||
      !node.enabled ||
      node.deleting ||
      (node.status === "draft" && process.env.NODE_ENV !== "development")
    )
      return false;
    const host = s.get(node.hostId);
    return host && !host.deleted && host.enabled && !host.deleting;
  });
}

export function hasPinnedTls(node: Entity) {
  return (
    node.tlsSecurity === "pinned" &&
    typeof node.sni === "string" &&
    node.sni.length > 0 &&
    typeof node.certSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(node.certSha256) &&
    typeof node.certSpkiSha256 === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(node.certSpkiSha256)
  );
}

export function hasEch(node: Entity) {
  return (
    hasPinnedTls(node) &&
    node.ech === true &&
    typeof node.echConfig === "string" &&
    node.echConfig.length > 0
  );
}

export function renderShadowrocket(nodes: Entity[], password: string) {
  const uris = nodes.map((node) => {
    const host = node.address.includes(":")
      ? `[${node.address}]`
      : node.address;
    const ports = node.hopping || node.port;
    const params = new URLSearchParams();
    if (hasPinnedTls(node)) {
      params.set("sni", node.sni);
      params.set("insecure", "1");
      params.set("pinSHA256", node.certSha256);
      if (hasEch(node)) params.set("ech", node.echConfig);
    } else {
      params.set("insecure", "1");
    }
    return `hysteria2://${encodeURIComponent(password)}@${host}:${ports}/?${params.toString()}#${encodeURIComponent(node.name)}`;
  });
  return Buffer.from(uris.join("\n")).toString("base64");
}
