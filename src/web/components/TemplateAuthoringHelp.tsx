import { BookOpen, ChevronDown, ChevronUp, FilePlus2 } from "lucide-react";
import { useId, useState } from "react";
import { t as translate } from "../i18n";
import { formatLabel, templateSyntaxLabel } from "../labels";
import type { TemplateFormat } from "../types";
import { Button, Chip, CopyButton } from "./primitives";
import { ScrollArea } from "./Scrollbars";

const STARTER_BY_FORMAT: Record<TemplateFormat, string> = {
  mihomo: `mixed-port: 7890
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
`,
  "sing-box": `{
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
}`,
};

/**
 * Collapsible Liquid + YAML/JSON authoring reference for mihomo and sing-box templates.
 */
export function TemplateAuthoringHelp({
  format,
  canInsertStarter = false,
  disabled = false,
  onInsertStarter,
}: {
  format: TemplateFormat;
  canInsertStarter?: boolean;
  disabled?: boolean;
  onInsertStarter?: (starter: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const isSingBox = format === "sing-box";
  const starter = STARTER_BY_FORMAT[format];

  return (
    <section className="studio-card authoring-help">
      <div className="authoring-help-bar">
        <div className="authoring-help-title">
          <BookOpen size={15} className="muted" aria-hidden="true" />
          <strong>{translate("Authoring guide")}</strong>
          <Chip mono>{formatLabel(format)}</Chip>
          <Chip mono>{templateSyntaxLabel(format)}</Chip>
        </div>
        <div className="authoring-help-actions">
          {canInsertStarter && onInsertStarter && (
            <Button
              variant="subtle"
              disabled={disabled}
              onClick={() => onInsertStarter(starter)}
            >
              <FilePlus2 size={14} aria-hidden="true" />
              {translate("Insert starter")}
            </Button>
          )}
          <Button
            variant="text"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? translate("Hide guide") : translate("Show variables")}
            {open ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {open && (
        <div id={panelId} className="authoring-help-body">
          <div className="authoring-help-cols">
            <div className="authoring-help-section">
              <span className="kpi-label">{translate("LIQUID VARIABLES")}</span>
              <dl className="authoring-vars">
                <div>
                  <dt className="mono">proxies / nodes</dt>
                  <dd>
                    {isSingBox
                      ? translate(
                          "Array of authorized Hysteria 2 sing-box outbound objects (each with tag, type, server, port, password, tls).",
                        )
                      : translate(
                          "Array of authorized Hysteria 2 mihomo proxy objects (each with name, type, server, port, password).",
                        )}
                  </dd>
                </div>
                <div>
                  <dt className="mono">choices</dt>
                  <dd>
                    {isSingBox
                      ? translate(
                          "List of authorized outbound tags, or [\"DIRECT\"] when no active nodes are available.",
                        )
                      : translate(
                          "List of authorized proxy names, or [\"DIRECT\"] when no active nodes are available.",
                        )}
                  </dd>
                </div>
                <div>
                  <dt className="mono">user.name</dt>
                  <dd>
                    {translate(
                      "Subscriber display name (redacted in portal previews).",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="mono">
                    {isSingBox ? "json" : "yaml · indent: N"}
                  </dt>
                  <dd>
                    {isSingBox
                      ? translate(
                          "Serializes a Liquid array or object to valid JSON. Required top-level sections: dns, inbounds, outbounds, route.",
                        )
                      : translate(
                          "Serializes to YAML and indents lines by N spaces (0–64). Required top-level sections: proxies, proxy-groups, rules, dns.",
                        )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="authoring-help-section">
              <div className="authoring-snippet-head">
                <span className="kpi-label">
                  {isSingBox
                    ? translate("SING-BOX JSON STARTER")
                    : translate("MIHOMO YAML STARTER")}
                </span>
                <div className="chip-group">
                  <CopyButton
                    text={starter}
                    label={translate("Copy")}
                    copiedLabel={translate("Copied")}
                  />
                  {onInsertStarter && (
                    <Button
                      variant="subtle"
                      disabled={disabled}
                      onClick={() => onInsertStarter(starter)}
                    >
                      {translate("Use starter")}
                    </Button>
                  )}
                </div>
              </div>
              <ScrollArea className="code-output authoring-snippet">
                <pre>{starter}</pre>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
