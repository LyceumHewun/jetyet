import { Liquid } from "liquidjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import type { Entity, Store } from "./db";
const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  ownPropertyOnly: true,
  parseLimit: 100000,
  renderLimit: 1000,
  memoryLimit: 10000000,
});
for (const name of ["include", "render", "layout", "extends"])
  engine.registerTag(name, {
    parse() {
      throw Error("File and partial loading is not allowed");
    },
    render() {
      return "";
    },
  });
engine.registerFilter("yaml", (v) => YAML.stringify(v).trimEnd());
export const defaultTemplate = `mixed-port: 7890
mode: rule
log-level: warning
allow-lan: false
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - https://1.1.1.1/dns-query
proxies:
{{ proxies | yaml | indent: 2 }}
proxy-groups:
  - name: Proxy
    type: select
    proxies:
{{ choices | yaml | indent: 6 }}
rules:
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT
  - IP-CIDR,172.16.0.0/12,DIRECT
  - IP-CIDR,192.168.0.0/16,DIRECT
  - MATCH,Proxy
`;
engine.registerFilter("indent", (v, n) =>
  String(v)
    .split("\n")
    .map((l) => " ".repeat(Number(n)) + l)
    .join("\n"),
);
export function seedTemplate(s: Store) {
  if (!s.list("template").length)
    s.put("template", {
      name: "Everyday",
      body: defaultTemplate,
      published: true,
      format: "mihomo",
    });
}
function proxies(s: Store, u: Entity, redacted: boolean) {
  const nodes = s.list("node").filter(
    (n) =>
      u.nodeIds.includes(n.id) &&
      n.enabled &&
      !n.deleting &&
      n.status !== "draft" &&
      (() => {
        const h = s.get(n.hostId);
        return h && !h.deleted && h.enabled && !h.deleting;
      })(),
  );
  const names = new Set<string>();
  return nodes.map((n) => {
    if (names.has(n.name))
      throw Error("Authorized nodes have duplicate display names");
    names.add(n.name);
    return {
      name: n.name,
      type: "hysteria2",
      server: n.address,
      port: n.port,
      ...(n.hopping ? { ports: n.hopping, "hop-interval": n.hopInterval } : {}),
      password: redacted ? "REDACTED" : s.secrets(u.id).vpnToken,
      "skip-cert-verify": true,
      udp: true,
      ...(n.upMbps ? { up: n.upMbps } : {}),
      ...(n.downMbps ? { down: n.downMbps } : {}),
    };
  });
}
export function render(s: Store, u: Entity, body: string, redacted = false) {
  if (/{%\s*(include|render|layout|extends)\b/i.test(body))
    throw Error("File and partial loading is not allowed");
  const p = proxies(s, u, redacted);
  const text = engine.parseAndRenderSync(body, {
    proxies: p,
    choices: p.length ? p.map((p) => p.name) : ["DIRECT"],
    user: { name: u.name },
    nodes: p,
  });
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw Error("Rendered configuration is too large");
  validateStructure(text);
  return text;
}
export function validateStructure(text: string) {
  const doc = YAML.parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw Error(doc.errors[0].message);
  const c = doc.toJS({ maxAliasCount: 100 });
  if (
    !c ||
    typeof c !== "object" ||
    !Array.isArray(c.proxies) ||
    !Array.isArray(c["proxy-groups"]) ||
    !Array.isArray(c.rules) ||
    !c.dns
  )
    throw Error(
      "A complete mihomo configuration requires proxies, proxy-groups, rules and dns",
    );
  const names = new Set([
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "COMPATIBLE",
  ]);
  for (const item of [...c.proxies, ...c["proxy-groups"]]) {
    if (!item?.name || names.has(item.name))
      throw Error("Duplicate or missing proxy/group name");
    names.add(item.name);
  }
  for (const g of c["proxy-groups"])
    if (
      (g.proxies !== undefined &&
        (!Array.isArray(g.proxies) ||
          g.proxies.some(
            (n: unknown) => typeof n !== "string" || !names.has(n),
          ))) ||
      (!g.proxies?.length &&
        !g.use?.length &&
        !g["include-all"] &&
        !g["include-all-proxies"] &&
        !g["include-all-providers"])
    )
      throw Error(`Invalid references or empty group: ${g.name}`);
}
export async function validateMihomo(s: Store, text: string) {
  const dir = await mkdtemp(join(tmpdir(), "jetyet-mihomo-"));
  try {
    const path = join(dir, "config.yaml");
    await writeFile(path, text, { mode: 0o600 });
    const child = Bun.spawn(
      [s.config.mihomoBinary, "-t", "-d", dir, "-f", path],
      { stdout: "pipe", stderr: "pipe" },
    );
    const timer = setTimeout(() => child.kill(), 15000);
    const [code] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timer);
    if (code !== 0)
      throw Error(
        "mihomo configuration validation failed; check groups, rules and DNS settings.",
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function templateGroupNames(s: Store): Set<string> {
  const names = new Set<string>();
  for (const t of s.list("template").filter((t) => t.published && t.body)) {
    try {
      const rendered = engine.parseAndRenderSync(t.body, {
        proxies: [],
        choices: ["DIRECT"],
        user: { name: "check" },
        nodes: [],
      });
      const parsed = YAML.parse(rendered, { maxAliasCount: 100 });
      if (Array.isArray(parsed?.["proxy-groups"])) {
        for (const g of parsed["proxy-groups"]) {
          if (typeof g?.name === "string" && g.name) names.add(g.name);
        }
      }
    } catch {
      // Ignore unparseable custom templates here; publish validation checks full rendering.
    }
  }
  return names;
}
