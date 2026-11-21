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
