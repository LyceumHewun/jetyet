# Jetyet

A personal Hysteria 2 control plane for your VPS hosts and friends' mihomo subscriptions. Bun and React, backed by SQLite, with native systemd-managed VPN services.

## Run locally

Requirements: Bun 1.3.5 or newer. Remote management also needs reachable Debian/Ubuntu VPS hosts with root or passwordless sudo, Python 3, curl, OpenSSL, iproute2, util-linux (`flock`) and systemd. Native binary deployment currently supports amd64 and arm64. Port hopping requires iptables and ip6tables. Install Hysteria 2 for end-to-end node probes and mihomo for template validation on the management server. Configure both executable paths.

```sh
bun install --frozen-lockfile
bun run setup
bun run dev
```

Choose `http://localhost:3000` as the origin for local development. In two other terminals:

```sh
bun run monitor
bun run operations
```

Open `http://localhost:3000`. The configuration's plaintext `admin.password` becomes an Argon2id `admin.passwordHash` at startup. To change it, add a new `password` and restart Web; all existing sessions become invalid. Configuration writes must succeed before startup continues. The generated master key protects stored SSH, VPN and node API credentials; losing it makes those credentials unreadable. No automated backups are created.

The interface is English. Displayed dates and reset schedules use Asia/Hong_Kong; explicitly labeled UTC form fields accept UTC. Traffic input labels distinguish binary GiB/TiB from decimal GB.

## Workflow

1. Add a VPS with its SSH address and credential. Inspect its fingerprint and compare it with a trusted source before selecting **Trust**. Host key changes block SSH until reconfirmed.
2. Plan one Hysteria 2 node on that host, with an advertised IPv4 or IPv6 address. Choose an explicit Hysteria 2 version when deploying. Native deployment refuses unmanaged Hysteria installations and unknown configuration.
3. Select **Deploy**, or **Show deploy command**, execute that sensitive script as root on the chosen VPS, then select **Detect installation**. Detection confirms the platform identity and configuration before enabling authentication. Allow the listen port and any hopping range in the provider firewall.
4. Create subscription users, assign current nodes and published templates, and configure allowances, expiration and reset schedules. New nodes are never automatically assigned.
5. Copy the user's subscription link into mihomo. Each user has independent subscription and VPN tokens. The built-in template is complete and needs no local merging.

Host and node configuration changes are deliberately separated: editing a node's network settings records the desired settings; inspect configuration drift and choose **Reapply configuration** to apply them. Service changes and upgrades may interrupt connections. User permission, token and quota changes use HTTP authentication and `/kick`, without restarting the service.

## Production

Run on one Linux cloud server, without containers. Install Bun at `/usr/local/bin/bun`, Hysteria at `/usr/local/bin/hysteria`, and mihomo at `/usr/local/bin/mihomo`. Obtain binaries from their official projects for your architecture. Place this project, including dependencies, at `/opt/jetyet`.

```sh
sudo useradd --system --home /var/lib/jetyet --shell /usr/sbin/nologin jetyet
sudo install -d -o jetyet -g jetyet -m 700 /var/lib/jetyet /etc/jetyet
# Create configuration interactively; use the public HTTPS origin.
sudo -u jetyet env JETYET_CONFIG=/etc/jetyet/jetyet.config.json /usr/local/bin/bun run setup
sudo cp deploy/jetyet-*.service /etc/systemd/system/
sudo systemctl daemon-reload
# Start Web first so plaintext configuration is converted before workers start.
sudo systemctl start jetyet-web
sudo systemctl enable --now jetyet-web jetyet-monitor jetyet-operations
```

Set the configuration's `database` to `/var/lib/jetyet/jetyet.sqlite` (the setup command otherwise defaults to a path relative to the configuration directory). The service account must be able to read `/opt/jetyet` and run the three binaries. The configuration directory must remain writable to permit atomic password replacement. The services have no local root privileges; root/passwordless sudo is required only on managed VPS hosts.

Use the HTTPS reverse proxy example in [deploy/nginx.conf](deploy/nginx.conf), adjusting the hostname and certificate paths. Web binds loopback by default. HTTPS protects login, subscription and installation downloads, and authentication callbacks. In every proxy or CDN in front of Jetyet, disable request-path logging for `/sub/`, `/deploy/`, and `/auth/hysteria/` because those paths contain secrets. Add the `/deploy/` logging exclusion to existing proxies before issuing manual installation links. Access the loopback-bound VPN Traffic Stats API over SSH.

VPS nodes deliberately use IP addresses, self-signed certificates, and `skip-cert-verify: true`, as requested. This does **not** apply to the management domain or authentication callback certificate, which must be trusted. Skipping node certificate verification does not authenticate server identity.

## Process boundaries

- **Web:** administrator sessions, CRUD, subscriptions, template preview/publication, Hysteria HTTP authentication.
- **Monitor:** 60-second host/resource/traffic collection, 5-minute authenticated proxy probes, reset processing, quota enforcement, urgent disconnections, retention and heartbeat.
- **Operations:** persisted SSH deployments, detection, upgrades, maintenance and deletion. Configuration changes serialize per VPS; deployments do not block monitoring or urgent `/kick` work.

SQLite WAL is shared by all three processes. Claims and authorization/disconnection changes are transactional. Task leases recover abandoned operations, which inspect the actual remote state before retrying. A remote `flock` also prevents recovered or manually executed deployments from overlapping a still-running remote mutation. Cancellation is honored at safe step boundaries; completed changes remain in place. Failures and per-host pending actions stay visible. Force removal requires explicit acknowledgement and records remote cleanup as unverified.

## Accounting and availability

Host usage comes from default-route interface counters, including non-VPN traffic. These local counters are not authoritative provider billing data; multi-interface/provider-specific accounting may differ. Enter initial current-period usage or use an audited correction when reconciling your provider bill. Node/user usage comes from Hysteria counters, stored directionally and attributed to stable user IDs. Probe traffic consumes host allowance but not friends' allowances.

Node/user directions describe the VPN client-facing leg: Hysteria `tx` is client upload (VPS inbound), and `rx` is client download (VPS outbound). Host counters include physical traffic on both client-facing and destination-facing legs, including protocol overhead; they need not equal node totals.

Manual resets preserve the next scheduled reset. Monthly resets clamp missing days to the month's last day; interval resets retain their anchor. Missed periods retain their original schedule. Ambiguous traffic crossing a reset or missing counter epochs is flagged rather than guessed. Historical usage, reset records and gap records remain available after deletion.

Quota enforcement is sampled, not a hard real-time byte cap. After exhaustion, new authentication is denied and existing sessions are kicked. If SSH is down, kicks remain pending and existing traffic can continue. If Web authentication is down, new connections fail while existing ones continue. Stale observations use the last known allowance state and raise an alert. There is no local authentication fallback.

Missing monitoring intervals are unknown, not downtime. Charts show observed availability with actual monitoring coverage. Online counts are client instances per node, not deduplicated physical devices. Resource aggregates retain mean and maximum values. Minute samples last 30 days, hourly aggregates one year, daily aggregates indefinitely. Resolved alerts and execution logs last 90 days; significant events remain indefinitely.

## Templates

Templates use Liquid with data-only rendering and YAML output. File/partial loading is disabled and rendering is bounded. Available values: `proxies`, `choices`, `nodes`, and `user.name`; filters include `yaml` and `indent`.

```liquid
proxies:
{{ proxies | yaml | indent: 2 }}
```

Save drafts while editing, including incomplete configurations. Preview and publication use mihomo for validation, and publication checks every assigned user's configuration. Publish a **complete** configuration, including DNS, proxy groups and rules. The built-in template uses `DIRECT` when no authorized nodes remain. Subscription downloads render the published template using current authorizations and credentials and check the resulting structure in-process.

## Development checks

```sh
bun run typecheck
bun run build
```

Test cases are intended for cloud CI; do not run them during local development unless necessary. GitHub Actions runs unit/integration cases, type checks, and the frontend build. Real SSH deployment, provider firewalls, IPv6 routing, actual node performance, and the 50-host/100-user/200-client capacity target require validation against deployment infrastructure.

See [CONTEXT.md](CONTEXT.md) for domain rules and [docs/deployment.md](docs/deployment.md) for agreed deployment requirements.
