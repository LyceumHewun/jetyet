import type { Row } from "./types";

export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const r = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await r.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event("signedout"));
    throw Error(data?.error || `Request failed (${r.status})`);
  }
  return data;
}

export const fmt = (n = 0) => {
  if (n >= 1024 ** 4) return (n / 1024 ** 4).toFixed(2) + " TiB";
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GiB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MiB";
  return Math.round(n / 1024) + " KiB";
};

export const when = (n: any) =>
  n
    ? new Date(n).toLocaleString("en-GB", {
        timeZone: "Asia/Hong_Kong",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const amount = (r: Row) =>
  r.quota?.direction === "in"
    ? r.usage?.inbound || 0
    : r.quota?.direction === "out"
      ? r.usage?.outbound || 0
      : (r.usage?.inbound || 0) + (r.usage?.outbound || 0);

export function formatUptime(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${Math.max(1, mins)}m`;
}

export function directionMeta(dir?: string): { short: string; label: string } {
  if (dir === "out") return { short: "Out", label: "Outbound only (from VPS)" };
  if (dir === "in") return { short: "In", label: "Inbound only (from VPS)" };
  return { short: "Both", label: "Outbound + inbound" };
}

export function parsePayload(raw: unknown): Row {
  if (raw && typeof raw === "object") return raw as Row;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function formatAlertCode(code: string): string {
  const text = String(code || "alert")
    .replaceAll("-", " ")
    .replace(/\bssh\b/gi, "SSH")
    .replace(/\bvps\b/gi, "VPS")
    .replace(/\bvpn\b/gi, "VPN");
  return text ? text[0].toUpperCase() + text.slice(1) : "Alert";
}

const taskKindLabels: Record<string, string> = {
  deploy: "Deploy Hysteria 2",
  upgrade: "Upgrade Hysteria 2",
  reapply: "Reapply configuration",
  detect: "Detect installation",
  "host-state": "Sync VPS state",
  "node-state": "Sync node state",
  kick: "Disconnect sessions",
  delete: "Remove remote service",
};

export function formatTaskKind(kind: string): string {
  return taskKindLabels[kind] || kind || "Operation";
}

export type TaskStep = {
  label: string;
  state: "done" | "active" | "error" | "pending";
};

export function taskProgress(task: Row): {
  percent: number;
  phaseLabel: string;
  steps: TaskStep[];
} {
  const labels =
    task.kind === "detect"
      ? ["Connect SSH", "Inspect deployment", "Verify service", "Completed"]
      : task.kind === "delete"
        ? ["Connect SSH", "Remove service", "Confirm cleanup", "Completed"]
        : ["Connect SSH", "Apply changes", "Verify node", "Completed"];
  const step = Math.max(0, Math.min(3, Number(task.step ?? 0)));
  const status = String(task.state || "queued");

  if (status === "succeeded") {
    return {
      percent: 100,
      phaseLabel: "Completed",
      steps: labels.map((label) => ({ label, state: "done" })),
    };
  }
  if (status === "failed" || status === "cancelled") {
    const failIdx = Math.min(3, step);
    return {
      percent: failIdx === 0 ? 15 : failIdx === 1 ? 45 : 75,
      phaseLabel: status === "cancelled" ? "Cancelled" : "Failed",
      steps: labels.map((label, idx) => ({
        label,
        state: idx < failIdx ? "done" : idx === failIdx ? "error" : "pending",
      })),
    };
  }
  if (status === "queued") {
    return {
      percent: 5,
      phaseLabel: "Queued for worker",
      steps: labels.map((label, idx) => ({
        label,
        state: idx === 0 ? "active" : "pending",
      })),
    };
  }
  const percent = step <= 0 ? 25 : step === 1 ? 55 : step === 2 ? 85 : 95;
  return {
    percent,
    phaseLabel: labels[step] || "Running",
    steps: labels.map((label, idx) => ({
      label,
      state: idx < step ? "done" : idx === step ? "active" : "pending",
    })),
  };
}

export function isHostReadyForNode(host: Row, nodes: Row[]): boolean {
  return Boolean(
    host &&
      host.fingerprint &&
      !host.deleting &&
      !nodes.some((n) => n.hostId === host.id),
  );
}

export function isNodeHealthy(node: Row, hosts: Row[]): boolean {
  const host = hosts.find((h) => h.id === node.hostId);
  return Boolean(
    node.enabled &&
      !node.deleting &&
      host?.enabled &&
      !host?.exhausted &&
      node.probe === "healthy" &&
      Date.now() - (node.probed || 0) < 600000,
  );
}

export function nodeStatusLabel(node: Row, hosts: Row[]): string {
  const host = hosts.find((h) => h.id === node.hostId);
  if (node.deleting || host?.deleting) return "Pending deletion";
  if (!node.enabled || !host?.enabled) return "Disabled";
  if (host?.exhausted) return "Quota exhausted";
  if (node.status === "draft") return "Planned";
  return node.service ? "Running" : "Stopped";
}

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw Error("Clipboard access unavailable. Select and copy manually.");
  }
  await navigator.clipboard.writeText(text);
}

const ipv4Pattern =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isValidIpLiteral(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (ipv4Pattern.test(v)) return true;
  if (!v.includes(":")) return false;
  return /^[0-9a-fA-F:]+$/.test(v) && v.split(":").length >= 3;
}

let supportsDisplayTransition: boolean | undefined;

export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

export function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.CSS?.supports?.("overlay", "auto") &&
    canTransitionDisplay()
  );
}
