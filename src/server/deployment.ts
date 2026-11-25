import YAML from "yaml";
import type { DeploymentOptions } from "../shared/schemas";
import { digest } from "./crypto";
import type { Entity, Store } from "./db";
import { adaptiveTuningScript } from "./deployment-tuning";
import { quote } from "./ssh";

export function nodeDeploymentOptions(node: Entity): DeploymentOptions {
  return {
    protocol: "hysteria2",
    congestion: node.congestion === "bbr" ? "bbr" : "brutal",
    tuning: node.tuning === true,
  };
}

export function validateDeploymentVersion(
  version: string,
  options: DeploymentOptions,
) {
  if (!/^v2\.\d+\.\d+$/.test(version))
    throw Error("Specify an explicit Hysteria 2 version");
  if (options.congestion === "bbr" && Number(version.split(".")[1]) < 8)
    throw Error("BBR mode requires Hysteria 2 v2.8.0 or later");
}

export function serverConfig(
  s: Store,
  n: Entity,
  options = nodeDeploymentOptions(n),
) {
  const secret = s.secrets(n.id);
  return YAML.stringify({
    listen: ":" + n.port,
    tls: { cert: "/etc/jetyet/server.crt", key: "/etc/jetyet/server.key" },
    auth: {
      type: "http",
      http: {
        url: `${s.config.origin}/auth/hysteria/${n.id}/${secret.authSecret}`,
        insecure: false,
      },
    },
    trafficStats: { listen: "127.0.0.1:9999", secret: secret.statsSecret },
    ...(options.congestion === "bbr"
      ? { congestion: { type: "bbr" }, ignoreClientBandwidth: true }
      : {}),
  });
}
export function redactedConfig(text: string) {
  const value = YAML.parse(text, { maxAliasCount: 100 });
  function visit(v: any): any {
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [
          k,
          /password|secret|token|private|auth|url/i.test(k)
            ? "[REDACTED]"
            : visit(val),
        ]),
      );
    return v;
  }
  return YAML.stringify(visit(value));
}
export function deploymentScript(
  s: Store,
  n: Entity,
  version: string,
  reapply = false,
  options = nodeDeploymentOptions(n),
) {
  validateDeploymentVersion(version, options);
  const config = serverConfig(s, n, options),
    desiredHash = digest(config),
    previousHash = digest(serverConfig(s, n)),
    manifest = JSON.stringify({
      owner: "jetyet",
      nodeId: n.id,
      hostId: n.hostId,
      address: n.address,
      configHash: desiredHash,
      version,
      hopping: n.hopping,
      port: n.port,
      ...options,
      phase: "ready",
    });
  // Literal base64 payloads avoid interpolating user-controlled values as shell syntax.
  const encoded = Buffer.from(config).toString("base64");
  const unit = `[Unit]\nDescription=Jetyet Hysteria 2\nAfter=network-online.target\nWants=network-online.target\n[Service]\n${n.hopping ? "ExecStartPre=/bin/bash /etc/jetyet/hopping-add.sh\nExecStopPost=/bin/bash /etc/jetyet/hopping-remove.sh\n" : ""}ExecStart=/usr/local/bin/hysteria server -c /etc/jetyet/config.yaml\nRestart=on-failure\nRestartSec=3\nLimitNOFILE=1048576\n[Install]\nWantedBy=multi-user.target\n`;
  return `set -Eeuo pipefail
trap 'status=$?; printf "Deployment failed at script line %s (exit %s)\\n" "$LINENO" "$status" >&2; exit "$status"' ERR
umask 077
test "$(id -u)" = 0 || { echo 'Root privileges required' >&2; exit 1; }
exec 9>/run/jetyet-operation.lock
flock -w 15 9 || { echo 'Another remote operation is still running' >&2; exit 1; }
. /etc/os-release
case "$ID" in debian|ubuntu) ;; *) echo 'Debian or Ubuntu required' >&2; exit 1;; esac
test -d /run/systemd/system
for cmd in curl openssl python3 ss ip sha256sum cmp flock; do command -v "$cmd" >/dev/null || { echo "Missing dependency: $cmd" >&2; exit 1; }; done
${
  n.hopping
    ? `if ! command -v iptables >/dev/null || ! command -v ip6tables >/dev/null; then
  echo 'Installing iptables for port hopping'
  command -v apt-get >/dev/null || { echo 'Missing apt-get; cannot install port hopping dependencies' >&2; exit 1; }
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables
fi
for cmd in iptables ip6tables; do command -v "$cmd" >/dev/null || { echo "Missing port hopping dependency after installation: $cmd" >&2; exit 1; }; done
`
    : ""
}
if test -e /etc/jetyet/manifest.json; then
  python3 -c ${quote(`import json; m=json.load(open('/etc/jetyet/manifest.json')); assert m['owner']=='jetyet' and m['nodeId']=='${n.id}' and m['hostId']=='${n.hostId}', 'Foreign deployment'`)}
  ${reapply ? "true" : `python3 -c ${quote(`import json,hashlib,os; m=json.load(open('/etc/jetyet/manifest.json')); p='/etc/jetyet/config.yaml'; allowed=['${previousHash}','${desiredHash}']; hashes=[m['configHash']] if m['phase']=='ready' else allowed; assert (m['configHash'] in allowed and hashlib.sha256(open(p,'rb').read()).hexdigest() in hashes if os.path.exists(p) else m['phase']=='installing'), 'Configuration drift: explicitly reapply platform configuration'`)}`}
else
  if test -e /etc/hysteria/config.yaml || systemctl is-active --quiet hysteria-server.service || test -e /etc/jetyet/config.yaml || command -v hysteria >/dev/null; then echo 'Existing unmanaged Hysteria installation; refusing overwrite' >&2; exit 1; fi
  if ss -H -lun | awk '{print $4}' | grep -Eq ':(${n.port}|9999)$'; then echo 'Port conflict' >&2; exit 1; fi
  if ss -H -ltn | awk '{print $4}' | grep -Eq ':9999$'; then echo 'Traffic API port conflict' >&2; exit 1; fi
fi
${n.hopping ? resolveHoppingAddress(n.address) : ""}
mkdir -p /etc/jetyet /usr/local/bin
python3 -c ${quote(`import json,hashlib,os; m=json.loads(${JSON.stringify(manifest)}); m['phase']='installing'; p='/etc/jetyet/config.yaml'; m['previousConfigHash']=hashlib.sha256(open(p,'rb').read()).hexdigest() if os.path.exists(p) else None; old=json.load(open('/etc/jetyet/manifest.json')) if os.path.exists('/etc/jetyet/manifest.json') else None; m['configHash']=old['configHash'] if old and old.get('configHash') else m['configHash']; f=open('/etc/jetyet/manifest.json.next','w'); json.dump(m,f); f.close(); os.replace('/etc/jetyet/manifest.json.next','/etc/jetyet/manifest.json')`)}
case "$(uname -m)" in x86_64) arch=amd64;; aarch64|arm64) arch=arm64;; *) echo 'Supported architectures: amd64, arm64' >&2; exit 1;; esac
if ! test -x /usr/local/bin/hysteria || ! /usr/local/bin/hysteria version | grep -Fwq ${quote(version)}; then
  curl -fLsS --retry 2 --max-time 120 ${quote(`https://github.com/apernet/hysteria/releases/download/app/${version}/hysteria-linux-`)}"$arch" -o /usr/local/bin/hysteria.next
  chmod 755 /usr/local/bin/hysteria.next
  /usr/local/bin/hysteria.next version | grep -Fw ${quote(version)} >/dev/null
  if test -f /usr/local/bin/hysteria; then cp /usr/local/bin/hysteria /usr/local/bin/hysteria.previous; fi
  mv /usr/local/bin/hysteria.next /usr/local/bin/hysteria
fi
if ! test -s /etc/jetyet/server.key || ! openssl x509 -checkend 0 -noout -in /etc/jetyet/server.crt >/dev/null 2>&1 || ! cmp -s <(openssl x509 -pubkey -noout -in /etc/jetyet/server.crt 2>/dev/null) <(openssl pkey -pubout -in /etc/jetyet/server.key 2>/dev/null); then
  openssl req -x509 -nodes -newkey rsa:4096 -keyout /etc/jetyet/server.key.next -out /etc/jetyet/server.crt.next -days 3650 -subj ${quote("/CN=" + n.address)} 2>/dev/null
  mv /etc/jetyet/server.key.next /etc/jetyet/server.key
  mv /etc/jetyet/server.crt.next /etc/jetyet/server.crt
fi
if test -f /etc/jetyet/config.yaml; then cp /etc/jetyet/config.yaml /etc/jetyet/config.previous.yaml; fi
printf %s ${quote(encoded)} | base64 -d > /etc/jetyet/config.yaml.next
chmod 600 /etc/jetyet/config.yaml.next /etc/jetyet/server.key
mv /etc/jetyet/config.yaml.next /etc/jetyet/config.yaml
printf %s ${quote(Buffer.from(unit).toString("base64"))} | base64 -d > /etc/systemd/system/jetyet-hysteria.service
# Remove only forwarding rules previously owned by this managed deployment.
if test -f /etc/jetyet/hopping-remove.sh; then bash /etc/jetyet/hopping-remove.sh; fi
rm -f /etc/jetyet/hopping-remove.sh /etc/jetyet/hopping-add.sh
${n.hopping ? hopScript(n) : ""}
${options.tuning ? adaptiveTuningScript : ""}
systemctl daemon-reload
systemctl enable jetyet-hysteria.service >/dev/null
systemctl restart jetyet-hysteria.service
sleep 2
systemctl is-active --quiet jetyet-hysteria.service
python3 -c ${quote("import json,sys; m=json.loads(sys.argv[1]); address=sys.argv[2]; m.update(hoppingAddress=address) if address else None; print(json.dumps(m))")} ${quote(manifest)} "${n.hopping ? "$hopping_address" : ""}" > /etc/jetyet/manifest.json.next
mv /etc/jetyet/manifest.json.next /etc/jetyet/manifest.json
echo 'Deployment verified'
`;
}
function resolveHoppingAddress(address: string) {
  return `hopping_address=$(python3 - ${quote(address)} <<'PY'
import ipaddress,json,subprocess,sys

advertised=ipaddress.ip_address(sys.argv[1])
family='-'+str(advertised.version)
interfaces=json.loads(subprocess.check_output(['ip',family,'-j','addr','show','up','scope','global']))
local={iface['ifname']:{ipaddress.ip_address(entry['local']) for entry in iface.get('addr_info', [])} for iface in interfaces}
if any(advertised in addresses for addresses in local.values()):
 print(advertised)
else:
 routes=json.loads(subprocess.check_output(['ip',family,'-j','route','get',str(advertised)]))
 route=routes[0]
 source=ipaddress.ip_address(route['prefsrc']) if route.get('prefsrc') else None
 if source not in local.get(route.get('dev'), set()):
  sys.exit('Cannot determine a local address for port hopping')
 print(source)
PY
)
echo "Port hopping destination: $hopping_address"
`;
}
function hopScript(n: Entity) {
  const isV6 = n.address.includes(":");
  const cmd = isV6 ? "ip6tables" : "iptables";
  const dest = `$hopping_address/${isV6 ? 128 : 32}`;
  const range = n.hopping.replace("-", ":");
  const rule = `-d ${dest} -p udp --dport ${range} -m comment --comment jetyet-${n.id} -j REDIRECT --to-ports ${n.port}`;
  const add = `${cmd} -t nat -C PREROUTING ${rule} 2>/dev/null || ${cmd} -t nat -A PREROUTING ${rule}`;
  const remove = `${cmd} -t nat -D PREROUTING ${rule} 2>/dev/null || true`;
  return `cat > /etc/jetyet/hopping-add.sh <<EOF
set -e
${add}
EOF
cat > /etc/jetyet/hopping-remove.sh <<EOF
set -e
${remove}
EOF
`;
}
export const detectionScript = `set -euo pipefail
python3 - <<'PY'
import ipaddress,json,hashlib,os,subprocess
m=json.load(open('/etc/jetyet/manifest.json'))
p='/etc/jetyet/config.yaml'
m['actualHash']=hashlib.sha256(open(p,'rb').read()).hexdigest() if os.path.exists(p) else None
m['active']=subprocess.run(['systemctl','is-active','--quiet','jetyet-hysteria.service']).returncode==0
m['actualVersion']=subprocess.run(['/usr/local/bin/hysteria','version'],capture_output=True,text=True).stdout.strip()
if m['active'] and m.get('hopping'):
 dport=m['hopping'].replace('-',':')
 comment='jetyet-'+m['nodeId']
 port=str(m['port'])
 if not m.get('hoppingAddress'):
  raise Exception('Port hopping address missing; redeploy the node')
 addr=ipaddress.ip_address(m['hoppingAddress'])
 cmd='ip6tables' if addr.version==6 else 'iptables'
 dest=f'{addr}/{addr.max_prefixlen}'
 subprocess.run([cmd,'-t','nat','-C','PREROUTING','-d',dest,'-p','udp','--dport',dport,'-m','comment','--comment',comment,'-j','REDIRECT','--to-ports',port],check=True,capture_output=True)
print(json.dumps(m))
PY
`;
export function removeScript(nodeId: string) {
  return `set -euo pipefail
exec 9>/run/jetyet-operation.lock
flock -w 15 9
if ! test -e /etc/jetyet/manifest.json; then
  if test -e /etc/jetyet/config.yaml || test -e /etc/systemd/system/jetyet-hysteria.service; then echo 'Unverified partial installation remains' >&2; exit 1; fi
  exit 0
fi
python3 -c ${quote(`import json; m=json.load(open('/etc/jetyet/manifest.json')); assert m['owner']=='jetyet' and m['nodeId']=='${nodeId}'`)}
systemctl disable --now jetyet-hysteria.service
if test -f /etc/jetyet/hopping-remove.sh; then bash /etc/jetyet/hopping-remove.sh; fi
rm -f /etc/systemd/system/jetyet-hysteria.service /etc/jetyet/config.yaml /etc/jetyet/config.previous.yaml /etc/jetyet/server.key /etc/jetyet/server.crt /etc/jetyet/manifest.json /etc/jetyet/hopping-remove.sh /etc/jetyet/hopping-add.sh /usr/local/bin/hysteria /usr/local/bin/hysteria.previous /usr/local/bin/hysteria.next
systemctl daemon-reload
`;
}
