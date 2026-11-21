import { formatDate, formatNumber, RequestError, t as translate } from "./i18n";
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
    const summary =
      data?.errorKind === "validation"
        ? "Validation failed. {0}"
        : /^hosts\/[^/]+\/(fingerprint|trust)$/.test(path)
          ? "SSH connection failed. {0}"
          : undefined;
    throw new RequestError(
      data?.error || `Request failed (${r.status})`,
      summary,
    );
  }
  return data;
}

export const fmt = (n = 0) => {
  if (n >= 1024 ** 4) return formatNumber(n / 1024 ** 4, 2) + " TiB";
  if (n >= 1024 ** 3) return formatNumber(n / 1024 ** 3, 2) + " GiB";
  if (n >= 1024 ** 2) return formatNumber(n / 1024 ** 2, 1) + " MiB";
  return formatNumber(n / 1024) + " KiB";
};

export function when(value?: string | number | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "—"
    : formatDate(date, {
        timeZone: "Asia/Hong_Kong",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
}

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
  if (days > 0) return translate("{0}d {1}h", days, hours);
  const mins = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? translate("{0}h {1}m", hours, mins)
    : translate("{0}m", Math.max(1, mins));
}

export function directionMeta(dir?: string): { short: string; label: string } {
  if (dir === "out")
    return {
      short: translate("Out"),
      label: translate("Outbound only (from VPS)"),
    };
  if (dir === "in")
    return {
      short: translate("In"),
      label: translate("Inbound only (from VPS)"),
    };
  return { short: translate("Both"), label: translate("Outbound + inbound") };
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

export function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText =
    "position:fixed;inset-block-start:0;inset-inline-start:0;opacity:0;pointer-events:none;";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

export function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.CSS?.supports?.("overlay", "auto") &&
    canTransitionDisplay()
  );
}
