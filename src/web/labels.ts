import { t } from "./i18n";
import type { Message } from "./messages";
import type { SubscriptionFormat, TemplateFormat } from "./types";

export const TEMPLATE_FORMATS: readonly TemplateFormat[] = [
  "mihomo",
  "sing-box",
];

export const SUBSCRIPTION_FORMATS: readonly SubscriptionFormat[] = [
  "mihomo",
  "sing-box",
  "shadowrocket",
];

export function formatLabel(format?: string): string {
  if (format === "shadowrocket") return "Shadowrocket";
  if (format === "mihomo") return "mihomo";
  if (format === "sing-box") return "sing-box";
  return format || "";
}

export function templateSyntaxLabel(format?: string): string {
  return format === "sing-box" ? "Liquid · JSON" : "Liquid · YAML";
}

const operationLabels: Record<string, Message> = {
  deploy: "Deploy",
  detect: "Detect installation",
  upgrade: "Upgrade",
  reapply: "Reapply config",
  "host-state": "VPS service state",
  "node-state": "Node service state",
  kick: "Revoke connections",
  delete: "Delete remote services",
};

const taskLabels: Record<string, Message> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const probeLabels: Record<string, Message> = {
  healthy: "Healthy",
  failed: "Unhealthy",
  skipped: "Probe skipped",
  pending: "Pending",
};

const alertLabels: Record<string, Message> = {
  "host-key": "SSH identity changed",
  unreachable: "SSH unreachable",
  "accounting-gap": "Accounting gap",
  drift: "Config drift",
  stats: "Traffic collection failure",
  service: "Service stopped",
  probe: "Connection probe failure",
  quota: "Quota exhausted",
  stale: "Stale data",
  "kick-pending": "Connection revocation pending",
  "operation-failed": "Operation failed",
  "worker-monitor": "Monitoring heartbeat missing",
  "worker-operations": "Operations heartbeat missing",
};

const eventLabels: Record<string, Message> = {
  "host.created": "VPS created",
  "host.updated": "VPS updated",
  "ssh.trusted": "Host key trusted",
  "node.planned": "Node planned",
  "nodes.unassigned": "Nodes unassigned",
  "user.created": "User created",
  "user.updated": "User updated",
  "deletion.requested": "Deletion requested",
  "deletion.completed": "Deletion completed",
  "deletion.forced": "Forced removal",
  "template.previewed": "Template previewed",
  "template.published": "Template published",
  "portal.password.changed": "Portal password changed",
  "portal.password-link.issued": "Portal password link issued",
  "credentials.rotated": "Credentials rotated",
  "traffic.manual-reset": "Traffic manually reset",
  "traffic.scheduled-reset": "Traffic reset by schedule",
  "traffic.gap": "Accounting gap",
  "traffic.corrected": "Traffic corrected",
  "operation.queued": "Operation queued",
  "operation.succeeded": "Operation succeeded",
  "operation.failed": "Operation failed",
  "operation.cancelled": "Operation cancelled",
};

function label(labels: Record<string, Message>, value: string) {
  return Object.hasOwn(labels, value) ? t(labels[value]) : value;
}

export const operationLabel = (value: string) => label(operationLabels, value);
export const taskLabel = (value: string) => label(taskLabels, value);
export const probeLabel = (value?: string) =>
  label(probeLabels, value ?? "pending");
export const alertLabel = (value: string) => label(alertLabels, value);
export const eventLabel = (value: string) => label(eventLabels, value);
