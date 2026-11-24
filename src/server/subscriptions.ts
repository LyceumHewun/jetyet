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

export function renderShadowrocket(nodes: Entity[], password: string) {
  const uris = nodes.map((node) => {
    const host = node.address.includes(":")
      ? `[${node.address}]`
      : node.address;
    const ports = node.hopping || node.port;
    return `hysteria2://${encodeURIComponent(password)}@${host}:${ports}/?insecure=1#${encodeURIComponent(node.name)}`;
  });
  return Buffer.from(uris.join("\n")).toString("base64");
}
