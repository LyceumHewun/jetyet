import YAML from "yaml";
import {
  DEFAULT_ECH_PUBLIC_NAME,
  DEFAULT_TLS_SNI,
  MIN_BBR_VERSION,
  MIN_ECH_VERSION,
  MIN_PINNED_TLS_VERSION,
  compareHysteriaVersion,
  deploymentOptionsSchema,
  type DeploymentOptions,
  type DeploymentOptionsInput,
} from "../shared/schemas";
import { digest } from "./crypto";
import type { Entity, Store } from "./db";
import { adaptiveTuningScript } from "./deployment-tuning";
import { quote } from "./ssh";

export const echKeysParserPy = `def parse_ech_keys_file(path):
 try:
  text=open(path).read()
  hk=re.search(r'-----BEGIN ECH KEYS-----(.*?)-----END ECH KEYS-----',text,re.S)
  if not hk: return None
  blob=base64.b64decode(''.join(hk.group(1).split()))
  off=0
  configs=bytearray()
  public_names=[]
  count=0
  while off<len(blob):
   if off+2>len(blob): return None
   priv_len,=struct.unpack_from('!H',blob,off); off+=2
   if priv_len==0 or off+priv_len+2>len(blob): return None
   off+=priv_len
   cfg_len,=struct.unpack_from('!H',blob,off); off+=2
   if cfg_len<4 or off+cfg_len>len(blob): return None
   cfg=blob[off:off+cfg_len]; off+=cfg_len
   ver,clen=struct.unpack_from('!HH',cfg,0)
   if 4+clen!=len(cfg): return None
   if ver==0xfe0d:
    pos=4
    end=4+clen
    if pos+5>end: return None
    pos+=3
    pk_len,=struct.unpack_from('!H',cfg,pos); pos+=2
    if pk_len==0 or pos+pk_len+2>end: return None
    pos+=pk_len
    cs_len,=struct.unpack_from('!H',cfg,pos); pos+=2
    if cs_len<4 or cs_len%4!=0 or pos+cs_len+2>end: return None
    pos+=cs_len
    pos+=1
    pn_len=cfg[pos]; pos+=1
    if pn_len==0 or pos+pn_len+2>end: return None
    pn=cfg[pos:pos+pn_len].decode('ascii').lower(); pos+=pn_len
    ext_len,=struct.unpack_from('!H',cfg,pos); pos+=2
    if pos+ext_len!=end: return None
    public_names.append(pn)
   configs.extend(cfg)
   count+=1
  if count==0 or not public_names: return None
  full_list=struct.pack('!H',len(configs))+bytes(configs)
  b64=base64.b64encode(full_list).decode('ascii')
  hc=re.search(r'-----BEGIN ECH CONFIGS-----(.*?)-----END ECH CONFIGS-----',text,re.S)
  configs_match=False
  if hc is not None:
   try:
    configs_match=(base64.b64decode(''.join(hc.group(1).split()), validate=True)==full_list)
   except Exception:
    configs_match=False
  return {'echConfig': b64, 'publicNames': public_names, 'configsBlockMatches': configs_match}
 except Exception:
  return None`;

export function nodeDeploymentOptions(node: Entity): DeploymentOptions {
  const tlsSecurity = node.tlsSecurity === "pinned" ? "pinned" : "legacy";
  const ech = tlsSecurity === "pinned" && node.ech === true;
  return {
    protocol: "hysteria2",
    congestion: node.congestion === "bbr" ? "bbr" : "brutal",
    tuning: node.tuning === true,
    tlsSecurity,
    sni:
      tlsSecurity === "pinned"
        ? typeof node.sni === "string" && node.sni
          ? node.sni
          : DEFAULT_TLS_SNI
        : "",
    ech,
    echPublicName: ech
      ? typeof node.echPublicName === "string" && node.echPublicName
        ? node.echPublicName
        : DEFAULT_ECH_PUBLIC_NAME
      : "",
  };
}

export function nodeVerifiedRevision(s: Store, n: Entity, host: Entity) {
  const options = nodeDeploymentOptions(n);
  return digest(
    JSON.stringify([
      serverConfig(s, n, options),
      options,
      n.address,
      n.hopping,
      host.fingerprint ?? "",
      n.version ?? "",
      n.configHash ?? "",
      n.deploymentId ?? "",
      n.certSha256 ?? "",
      n.echConfig ?? "",
    ]),
  );
}

export function validateDeploymentVersion(
  version: string,
  rawOptions: DeploymentOptionsInput,
) {
  const options = deploymentOptionsSchema.parse(rawOptions);
  if (!/^v2\.\d+\.\d+$/.test(version))
    throw Error("Specify an explicit Hysteria 2 version");
  if (options.ech && options.tlsSecurity !== "pinned")
    throw Error("ECH requires forced SNI and pinSHA256 TLS security");
  if (
    options.tlsSecurity === "pinned" &&
    compareHysteriaVersion(version, MIN_PINNED_TLS_VERSION) < 0
  )
    throw Error("Forced SNI and pinSHA256 require Hysteria 2 v2.6.4 or later");
  if (
    options.congestion === "bbr" &&
    compareHysteriaVersion(version, MIN_BBR_VERSION) < 0
  )
    throw Error("BBR mode requires Hysteria 2 v2.8.0 or later");
  if (options.ech && compareHysteriaVersion(version, MIN_ECH_VERSION) < 0)
    throw Error("ECH requires Hysteria 2 v2.12.3 or later");
}

export function serverConfig(
  s: Store,
  n: Entity,
  rawOptions: DeploymentOptionsInput = nodeDeploymentOptions(n),
) {
  const options = deploymentOptionsSchema.parse(rawOptions);
  const secret = s.secrets(n.id);
  return YAML.stringify({
    listen: ":" + n.port,
    tls: {
      cert: "/etc/jetyet/server.crt",
      key: "/etc/jetyet/server.key",
      ...(options.tlsSecurity === "pinned" ? { sniGuard: "strict" } : {}),
    },
    ...(options.ech ? { ech: { keyPath: "/etc/jetyet/ech.pem" } } : {}),
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
  rawOptions: DeploymentOptionsInput = nodeDeploymentOptions(n),
) {
  const options = deploymentOptionsSchema.parse(rawOptions);
  const previousOptions = nodeDeploymentOptions(n);
  validateDeploymentVersion(version, options);
  const config = serverConfig(s, n, options),
    desiredHash = digest(config),
    previousHash = digest(serverConfig(s, n)),
    previousVersion = typeof n.version === "string" ? n.version : "",
    previousDeploymentId =
      typeof n.deploymentId === "string" ? n.deploymentId : "",
    deploymentId = digest(
      JSON.stringify([
        n.id,
        version,
        desiredHash,
        options,
        previousVersion,
        previousHash,
        previousDeploymentId,
      ]),
    ),
    manifest = JSON.stringify({
      owner: "jetyet",
      nodeId: n.id,
      hostId: n.hostId,
      address: n.address,
      configHash: desiredHash,
      deploymentId,
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
  ${
    reapply
      ? "true"
      : `python3 -c ${quote(`import json,hashlib,os; m=json.load(open('/etc/jetyet/manifest.json')); p='/etc/jetyet/config.yaml'; allowed=['${previousHash}','${desiredHash}']; hashes=[m['configHash']] if m['phase']=='ready' else allowed; sec=lambda o: (o.get('tlsSecurity') if o.get('tlsSecurity')=='pinned' else 'legacy', o.get('sni') or '', bool(o.get('ech')), o.get('echPublicName') or ''); prev_ver=${JSON.stringify(previousVersion)}; prev_id=${JSON.stringify(previousDeploymentId)}; next_id=${JSON.stringify(deploymentId)}; prev_sec=sec(json.loads(${JSON.stringify(JSON.stringify(previousOptions))})); next_sec=sec(json.loads(${JSON.stringify(JSON.stringify(options))})); cur_ver=m.get('version') or ''; cur_id=m.get('deploymentId') or ''; cur_sec=sec(m); same_retry=(cur_id==next_id and cur_ver==${JSON.stringify(version)} and m['configHash']=='${desiredHash}' and cur_sec==next_sec); prev_match=(bool(prev_ver) and cur_ver==prev_ver and m['configHash']=='${previousHash}' and cur_sec==prev_sec and (not prev_id or cur_id==prev_id)); ready_ok=(prev_match or same_retry); install_ok=((cur_id==next_id and cur_ver==${JSON.stringify(version)} and cur_sec==next_sec) or (bool(prev_ver) and m['configHash']=='${previousHash}' and cur_sec==prev_sec)); assert ((ready_ok and os.path.exists(p) and hashlib.sha256(open(p,'rb').read()).hexdigest() in hashes) if m['phase']=='ready' else (m['phase']=='installing' and install_ok and (not os.path.exists(p) or hashlib.sha256(open(p,'rb').read()).hexdigest() in allowed))), 'Configuration drift: explicitly reapply platform configuration'`)}`
  }
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
${certificateStep(n, options)}
${echStep(options)}
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
function certificateStep(n: Entity, options: DeploymentOptions) {
  if (options.tlsSecurity === "pinned") {
    const cn = options.sni.length <= 64 ? options.sni : "jetyet-node";
    const checkSan =
      "import re,subprocess,sys; out=subprocess.run(['openssl','x509','-noout','-ext','subjectAltName','-in',sys.argv[1]],capture_output=True,text=True); sans=[m.lower() for m in re.findall(r'DNS:([^,\\s]+)', out.stdout)]; sys.exit(0 if out.returncode==0 and sys.argv[2].lower() in sans else 1)";
    return `if ! test -s /etc/jetyet/server.key || ! openssl x509 -checkend 0 -noout -in /etc/jetyet/server.crt >/dev/null 2>&1 || ! cmp -s <(openssl x509 -pubkey -noout -in /etc/jetyet/server.crt 2>/dev/null) <(openssl pkey -pubout -in /etc/jetyet/server.key 2>/dev/null) || ! python3 -c ${quote(checkSan)} /etc/jetyet/server.crt ${quote(options.sni)}; then
  openssl req -x509 -nodes -newkey rsa:4096 -keyout /etc/jetyet/server.key.next -out /etc/jetyet/server.crt.next -days 3650 -subj ${quote("/CN=" + cn)} -addext ${quote("subjectAltName=DNS:" + options.sni)} 2>/dev/null
  mv /etc/jetyet/server.key.next /etc/jetyet/server.key
  mv /etc/jetyet/server.crt.next /etc/jetyet/server.crt
fi`;
  }
  const checkNoDnsSan =
    "import re,subprocess,sys; out=subprocess.run(['openssl','x509','-noout','-ext','subjectAltName','-in',sys.argv[1]],capture_output=True,text=True); sans=re.findall(r'DNS:([^,\\s]+)', out.stdout) if out.returncode==0 else []; sys.exit(0 if len(sans)==0 else 1)";
  return `if ! test -s /etc/jetyet/server.key || ! openssl x509 -checkend 0 -noout -in /etc/jetyet/server.crt >/dev/null 2>&1 || ! cmp -s <(openssl x509 -pubkey -noout -in /etc/jetyet/server.crt 2>/dev/null) <(openssl pkey -pubout -in /etc/jetyet/server.key 2>/dev/null) || ! python3 -c ${quote(checkNoDnsSan)} /etc/jetyet/server.crt; then
  openssl req -x509 -nodes -newkey rsa:4096 -keyout /etc/jetyet/server.key.next -out /etc/jetyet/server.crt.next -days 3650 -subj ${quote("/CN=" + n.address)} 2>/dev/null
  mv /etc/jetyet/server.key.next /etc/jetyet/server.key
  mv /etc/jetyet/server.crt.next /etc/jetyet/server.crt
fi`;
}
function echStep(options: DeploymentOptions) {
  if (!options.ech) {
    return "rm -f /etc/jetyet/ech.pem /etc/jetyet/ech.pem.next";
  }
  const reuseOrRepairEchScript = `import base64,os,re,struct,sys
${echKeysParserPy}
path=sys.argv[1]
target=sys.argv[2].lower()
parsed=parse_ech_keys_file(path)
if not parsed or not all(pn==target for pn in parsed['publicNames']):
 sys.exit(1)
if not parsed['configsBlockMatches']:
 text=open(path).read()
 hk=re.search(r'-----BEGIN ECH KEYS-----.*?-----END ECH KEYS-----',text,re.S)
 if not hk: sys.exit(1)
 lines=[parsed['echConfig'][i:i+64] for i in range(0,len(parsed['echConfig']),64)]
 rebuilt=hk.group(0).strip()+'\\n-----BEGIN ECH CONFIGS-----\\n'+'\\n'.join(lines)+'\\n-----END ECH CONFIGS-----\\n'
 tmp=path+'.next'
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f: f.write(rebuilt)
 os.replace(tmp,path)
sys.exit(0)`;
  return `if ! test -s /etc/jetyet/ech.pem || ! python3 -c ${quote(reuseOrRepairEchScript)} /etc/jetyet/ech.pem ${quote(options.echPublicName)} 2>/dev/null; then
  /usr/local/bin/hysteria ech --public-name ${quote(options.echPublicName)} -o /etc/jetyet/ech.pem.next --overwrite >/dev/null
  chmod 600 /etc/jetyet/ech.pem.next
  mv /etc/jetyet/ech.pem.next /etc/jetyet/ech.pem
fi
chmod 600 /etc/jetyet/ech.pem`;
}
const inspectAndVerifyPy = `import base64,ipaddress,json,hashlib,os,re,struct,subprocess,tempfile,time
${echKeysParserPy}
def inspect_remote(run_live_probe=True):
 m=json.load(open('/etc/jetyet/manifest.json'))
 p='/etc/jetyet/config.yaml'
 m['actualHash']=hashlib.sha256(open(p,'rb').read()).hexdigest() if os.path.exists(p) else None
 m['active']=subprocess.run(['systemctl','is-active','--quiet','jetyet-hysteria.service']).returncode==0
 m['actualVersion']=subprocess.run(['/usr/local/bin/hysteria','version'],capture_output=True,text=True).stdout.strip()
 cert_path='/etc/jetyet/server.crt'
 if os.path.exists(cert_path):
  der=subprocess.check_output(['openssl','x509','-in',cert_path,'-outform','DER'])
  m['certSha256']=hashlib.sha256(der).hexdigest()
  pub=subprocess.check_output(['openssl','x509','-in',cert_path,'-pubkey','-noout'])
  spki=subprocess.check_output(['openssl','pkey','-pubin','-outform','DER'],input=pub)
  m['certSpkiSha256']=base64.b64encode(hashlib.sha256(spki).digest()).decode('ascii')
  san_out=subprocess.run(['openssl','x509','-in',cert_path,'-noout','-ext','subjectAltName'],capture_output=True,text=True)
  m['certDnsSans']=sorted({s.lower() for s in re.findall(r'DNS:([^,\\s]+)', san_out.stdout)}) if san_out.returncode==0 else []
 ech_path='/etc/jetyet/ech.pem'
 if os.path.exists(ech_path):
  parsed=parse_ech_keys_file(ech_path)
  if parsed:
   m['echConfig']=parsed['echConfig']
   m['echDetectedPublicNames']=parsed['publicNames']
   m['echDetectedPublicName']=parsed['publicNames'][0]
 if m['active'] and run_live_probe:
  inv_before=subprocess.run(['systemctl','show','--value','--property=InvocationID','jetyet-hysteria.service'],capture_output=True,text=True).stdout.strip()
  mono_us_out=subprocess.run(['systemctl','show','--value','--property=ActiveEnterTimestampMonotonic','jetyet-hysteria.service'],capture_output=True,text=True).stdout.strip()
  start_s=None
  if mono_us_out.isdigit() and int(mono_us_out)>0:
   age_s=time.clock_gettime(time.CLOCK_MONOTONIC)-(int(mono_us_out)/1_000_000.0)
   if age_s>=-0.5:
    start_s=time.time()-age_s
  checked_files=[p, cert_path, '/etc/jetyet/server.key']
  if m.get('ech') is True: checked_files.append(ech_path)
  m['runtimeFresh']=bool(start_s is not None and all(os.path.exists(fp) and os.path.getmtime(fp)<=start_s+0.5 for fp in checked_files))
  live_ok=False
  if m.get('port'):
   def probe_once(host, tls_cfg):
    with tempfile.TemporaryDirectory(prefix='jetyet-tls-verify-') as td:
     cfg_path=os.path.join(td,'client.json')
     with open(cfg_path,'w') as f:
      json.dump({'server': f'{host}:{m["port"]}', 'auth': 'jetyet-live-tls-verify', 'tls': tls_cfg}, f)
     try:
      r=subprocess.run(['/usr/local/bin/hysteria','client','-c',cfg_path],capture_output=True,text=True,timeout=6)
      return (r.stdout or '')+'\\n'+(r.stderr or '')
     except subprocess.TimeoutExpired:
      return ''
   pos_tls={'insecure': True}
   if m.get('tlsSecurity')=='pinned':
    pos_tls['sni']=m.get('sni') or ''
    pos_tls['pinSHA256']=m.get('certSha256') or ''
    if m.get('ech') is True:
     pos_tls['ech']=m.get('echConfig') or ''
   matched_host=None
   for host in ('127.0.0.1','[::1]'):
    if 'authentication error, HTTP status code:' in probe_once(host, pos_tls):
     matched_host=host
     break
   if matched_host:
    if m.get('tlsSecurity')=='pinned':
     forbidden=set(m.get('certDnsSans') or [])
     if m.get('sni'): forbidden.add(m['sni'].lower())
     neg_sni='jetyet-sni-mismatch.invalid'
     idx=1
     while neg_sni in forbidden:
      neg_sni=f'jetyet-sni-mismatch-{idx}.invalid'
      idx+=1
     neg_tls=dict(pos_tls)
     neg_tls['sni']=neg_sni
     neg_out=probe_once(matched_host, neg_tls)
     tls_rejected=bool(re.search(r'CRYPTO_ERROR|remote error:|\\btls:|unrecognized name|handshake failure', neg_out, re.I))
     live_ok=('authentication error, HTTP status code:' not in neg_out) and tls_rejected
    else:
     live_ok=True
  inv_after=subprocess.run(['systemctl','show','--value','--property=InvocationID','jetyet-hysteria.service'],capture_output=True,text=True).stdout.strip()
  m['liveTlsVerified']=bool(live_ok and inv_before and inv_before==inv_after)
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
 return m`;

export const detectionScript = `set -euo pipefail
exec 9>/run/jetyet-operation.lock
flock -w 15 9
python3 - <<'PY'
${inspectAndVerifyPy}
print(json.dumps(inspect_remote(True)))
PY
`;

export const controlledProbeScript = `set -euo pipefail
exec 9>/run/jetyet-operation.lock
flock -w 15 9
python3 - <<'PY'
${inspectAndVerifyPy}
started=False
try:
 if subprocess.run(['systemctl','is-active','--quiet','jetyet-hysteria.service']).returncode!=0:
  subprocess.run(['systemctl','start','jetyet-hysteria.service'],check=True)
  started=True
  time.sleep(1)
 result=inspect_remote(True)
finally:
 if started:
  subprocess.run(['systemctl','stop','jetyet-hysteria.service'],check=True)
if started:
 if subprocess.run(['systemctl','is-active','--quiet','jetyet-hysteria.service']).returncode==0:
  raise Exception('Temporary verification start failed to stop service')
 result['active']=False
 result['controlledProbe']=True
print(json.dumps(result))
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
rm -f /etc/systemd/system/jetyet-hysteria.service /etc/jetyet/config.yaml /etc/jetyet/config.previous.yaml /etc/jetyet/server.key /etc/jetyet/server.crt /etc/jetyet/ech.pem /etc/jetyet/ech.pem.next /etc/jetyet/manifest.json /etc/jetyet/hopping-remove.sh /etc/jetyet/hopping-add.sh /usr/local/bin/hysteria /usr/local/bin/hysteria.previous /usr/local/bin/hysteria.next
systemctl daemon-reload
`;
}
