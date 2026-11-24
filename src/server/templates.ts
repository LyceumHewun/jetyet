import { Liquid } from "liquidjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import type { TemplateFormat } from "../shared/schemas";
import { subscriptionNodes } from "./subscriptions";
import type { Entity, Store } from "./db";
const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  ownPropertyOnly: true,
  parseLimit: 100000,
  renderLimit: 1000,
  memoryLimit: 10000000,
});
const credentialField =
  /(?:^|[-_])(?:password|passwd|uuid|token|secret|username|authentication|auth|authorization|key|cookie|psk)(?:$|[-_])|^(?:api|private|access)key$/i;

function isCredentialField(key: string) {
  return credentialField.test(key.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
}

function redactQueryCredentials(value: string) {
  return value.replace(
    /([?&])([^=&#\s]+)=[^&#\s]+/g,
    (match, delimiter: string, key: string) => {
      let decoded = key;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        // Malformed escapes can still contain a recognizable credential key.
      }
      return isCredentialField(decoded) ? `${delimiter}${key}=REDACTED` : match;
    },
  );
}
const commaPayloadRules = new Set([
  "NOT",
  "OR",
  "AND",
  "SUB-RULE",
  "DOMAIN-REGEX",
  "PROCESS-NAME-REGEX",
  "PROCESS-PATH-REGEX",
]);

function ruleTarget(parts: string[]) {
  const type = parts[0].trim().toUpperCase();
  if (type === "MATCH") return 1;
  return commaPayloadRules.has(type) ? parts.length - 1 : 2;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactQueryCredentials(
      value
        .replace(
          /\/sub\/[a-zA-Z0-9_-]+|\/set-password#[a-zA-Z0-9_-]+/g,
          "[REDACTED]",
        )
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1REDACTED@"),
    );
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isCredentialField(key)
          ? Array.isArray(item)
            ? []
            : "REDACTED"
          : redact(item),
      ]),
    );
  return value;
}

function redactPreview(text: string, literalNames: Map<string, string>) {
  const config = YAML.parse(text, { maxAliasCount: 100 });
  const names = new Map<string, string>();
  const groupNames = new Set(
    config["proxy-groups"].map((g: { name: string }) => g.name),
  );
  for (const proxy of config.proxies) {
    if (typeof proxy?.name !== "string" || !proxy.name || names.has(proxy.name))
      throw Error("Duplicate or missing proxy name");
    let placeholder = `Preview node ${names.size + 1}`;
    while (groupNames.has(placeholder)) placeholder += " (preview)";
    names.set(proxy.name, placeholder);
    proxy.name = placeholder;
    const host = `node-${names.size}.invalid`;
    if ("server" in proxy) proxy.server = host;
    if ("port" in proxy) proxy.port = 443;
    if ("ports" in proxy) proxy.ports = "443-444";
    if ("sni" in proxy) proxy.sni = host;
    if ("servername" in proxy) proxy.servername = host;
    if ("server-name" in proxy) proxy["server-name"] = host;
  }
  for (const [literal, simulated] of literalNames) {
    const placeholder = names.get(simulated);
    if (placeholder) names.set(literal, placeholder);
  }
  for (const group of config["proxy-groups"]) {
    if (Array.isArray(group.proxies))
      group.proxies = group.proxies.map(
        (name: string) => names.get(name) ?? name,
      );
  }
  for (const proxy of config.proxies) {
    const alias = names.get(proxy["dialer-proxy"]);
    if (alias) proxy["dialer-proxy"] = alias;
  }
  for (const rules of [
    config.rules,
    ...Object.values(config["sub-rules"] ?? {}),
  ]) {
    if (!Array.isArray(rules)) continue;
    for (const [i, rule] of rules.entries()) {
      if (typeof rule !== "string") continue;
      const parts = rule.split(",");
      if (parts[0].trim().toUpperCase() === "SUB-RULE") continue;
      const index = ruleTarget(parts);
      const replacement = names.get(parts[index]?.trim());
      if (replacement) {
        parts[index] = replacement;
        rules[i] = parts.join(",");
      }
    }
  }
  return YAML.stringify(redact(config));
}
for (const name of ["include", "render", "layout", "extends"])
  engine.registerTag(name, {
    parse() {
      throw Error("File and partial loading is not allowed");
    },
    render() {
      return "";
    },
  });
engine.registerFilter("json", (value) => JSON.stringify(value));
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
engine.registerFilter("indent", (v, n) => {
  const width = Number(n);
  if (!Number.isInteger(width) || width < 0 || width > 64)
    throw Error("Indent must be between 0 and 64 spaces");
  return String(v)
    .split("\n")
    .map((l) => " ".repeat(width) + l)
    .join("\n");
});
const singBoxTemplate = `{
  "log": {"level": "warn"},
  "dns": {"servers": [{"type": "https", "tag": "cloudflare", "server": "1.1.1.1"}], "final": "cloudflare"},
  "inbounds": [{"type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30"], "auto_route": true}],
  "outbounds": [
    {"type": "direct", "tag": "DIRECT"},
    {"type": "selector", "tag": "Proxy", "outbounds": {{ choices | json }}}
    {% for node in nodes %}, {{ node | json }}{% endfor %}
  ],
  "route": {
    "auto_detect_interface": true,
    "default_domain_resolver": "cloudflare",
    "rules": [
      {"action": "sniff"},
      {"protocol": "dns", "action": "hijack-dns"},
      {"ip_is_private": true, "outbound": "DIRECT"}
    ],
    "final": "Proxy"
  }
}`;

export function seedTemplate(s: Store) {
  for (const [format, body] of [
    ["mihomo", defaultTemplate],
    ["sing-box", singBoxTemplate],
  ]) {
    if (!s.list("template").some((t) => t.format === format && t.builtin))
      s.put("template", {
        name: "Everyday",
        body,
        published: true,
        format,
        builtin: true,
      });
  }
}
type RenderMode =
  "live" | "admin-preview" | "portal-preview" | "assigned-preview";

function isPortalPreview(mode: RenderMode) {
  return mode === "portal-preview" || mode === "assigned-preview";
}

function proxies(
  s: Store,
  u: Entity,
  mode: RenderMode,
  format: TemplateFormat,
) {
  const nodes = subscriptionNodes(s, u);
  const names = new Set(nodes.map((n) => n.name));
  if (names.size !== nodes.length)
    throw Error("Authorized nodes have duplicate display names");
  const literalNames = new Map<string, string>();
  const rows = nodes.map((n, i) => {
    let name = n.name;
    const simulated = isPortalPreview(mode);
    if (simulated) {
      name = `Preview input ${i + 1}`;
      if (mode === "assigned-preview") {
        while (names.has(name)) name += " (simulated)";
        literalNames.set(n.name, name);
      }
    }
    if (format === "sing-box") {
      return {
        name,
        tag: name,
        type: "hysteria2",
        server: simulated ? "node-" + (i + 1) + ".invalid" : n.address,
        ...(n.hopping
          ? {
              server_ports: [n.hopping.replace("-", ":")],
              hop_interval: n.hopInterval + "s",
            }
          : { server_port: simulated ? 443 : n.port }),
        password: mode === "live" ? s.secrets(u.id).vpnToken : "REDACTED",
        tls: { enabled: true, insecure: true },
        ...(n.congestion === "bbr" ? {} : { up_mbps: 1000, down_mbps: 1000 }),
      };
    }
    return {
      name,
      type: "hysteria2",
      server: simulated ? `node-${i + 1}.invalid` : n.address,
      ...(!simulated && n.hopping
        ? {
            ports: n.hopping,
            "hop-interval": n.hopInterval,
          }
        : { port: simulated ? 443 : n.port }),
      password: mode === "live" ? s.secrets(u.id).vpnToken : "REDACTED",
      "skip-cert-verify": true,
      udp: true,
      ...(n.congestion === "bbr"
        ? { "bbr-profile": "standard" }
        : { up: 1000, down: 1000 }),
    };
  });
  return { rows, literalNames };
}
export function render(
  s: Store,
  u: Entity,
  body: string,
  mode: RenderMode = "live",
  format: TemplateFormat = "mihomo",
) {
  if (/{%\s*(include|render|layout|extends)\b/i.test(body))
    throw Error("File and partial loading is not allowed");
  const { rows: p, literalNames } = proxies(s, u, mode, format);
  const rows = format === "sing-box" ? p.map(({ name, ...row }) => row) : p;
  const text = engine.parseAndRenderSync(body, {
    proxies: rows,
    choices: p.length ? p.map((p) => p.name) : ["DIRECT"],
    user: { name: isPortalPreview(mode) ? "Subscriber" : u.name },
    nodes: rows,
  });
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw Error("Rendered configuration is too large");
  if (format === "sing-box") {
    const config = JSON.parse(text);
    if (
      !Array.isArray(config?.outbounds) ||
      !Array.isArray(config?.inbounds) ||
      !config.dns ||
      !config.route
    )
      throw Error(
        "A complete sing-box configuration requires inbounds, outbounds, DNS and routing",
      );
    const tags = new Set<string>();
    for (const outbound of config.outbounds) {
      if (
        typeof outbound?.tag !== "string" ||
        !outbound.tag ||
        tags.has(outbound.tag)
      )
        throw Error("Duplicate or missing outbound tag");
      tags.add(outbound.tag);
    }
    for (const outbound of config.outbounds) {
      if (
        ["selector", "urltest"].includes(outbound.type) &&
        (!Array.isArray(outbound.outbounds) ||
          !outbound.outbounds.length ||
          outbound.outbounds.some((tag: string) => !tags.has(tag)))
      )
        throw Error("Invalid sing-box outbound selection");
    }
    return mode === "live" ? text : JSON.stringify(redact(config), null, 2);
  }
  const output = isPortalPreview(mode)
    ? redactPreview(text, literalNames)
    : text;
  validateStructure(output);
  return output;
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
    !c.dns ||
    typeof c.dns !== "object" ||
    Array.isArray(c.dns)
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
  const subRules = Object.keys(c["sub-rules"] ?? {});
  for (const rules of [c.rules, ...Object.values(c["sub-rules"] ?? {})]) {
    if (!Array.isArray(rules)) throw Error("Invalid routing rule list");
    for (const rule of rules) {
      if (typeof rule !== "string")
        throw Error("Routing rules must be strings");
      const parts = rule.split(",").map((part) => part.trim());
      const [type] = parts;
      const index = ruleTarget(parts);
      const target = parts[index];
      if (!type || index < 1 || !target)
        throw Error("Routing rule is missing a policy");
      if (
        !names.has(target) &&
        target !== "GLOBAL" &&
        !(type.toUpperCase() === "SUB-RULE" && subRules.includes(target))
      )
        throw Error(`Routing rule points to an unavailable policy: ${target}`);
    }
  }
}
export async function validateCore(
  s: Store,
  text: string,
  format: TemplateFormat,
) {
  const dir = await mkdtemp(join(tmpdir(), "jetyet-template-"));
  try {
    const path = join(dir, format === "mihomo" ? "config.yaml" : "config.json");
    await writeFile(path, text, { mode: 0o600 });
    const args =
      format === "mihomo"
        ? [s.config.mihomoBinary, "-t", "-d", dir, "-f", path]
        : [s.config.singBoxBinary, "check", "-c", path, "-D", dir];
    let child;
    try {
      child = Bun.spawn(args, { cwd: dir, stdout: "ignore", stderr: "ignore" });
    } catch {
      throw Error(format + " validation core is unavailable");
    }
    const timer = setTimeout(() => child.kill(), 15000);
    const code = await child.exited.finally(() => clearTimeout(timer));
    if (code !== 0)
      throw Error(
        format +
          " configuration validation failed; check groups, rules and DNS settings.",
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function templateGroupNames(s: Store): Set<string> {
  const names = new Set<string>();
  for (const t of s
    .list("template")
    .filter((t) => t.format === "mihomo" && t.published && t.body)) {
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
