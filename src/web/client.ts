import type { Row } from "./types";
export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
