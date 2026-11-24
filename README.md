# Jetyet

A personal Hysteria 2 control plane for your VPS hosts and friends' VPN subscriptions. Bun and React, backed by SQLite, with native systemd-managed VPN services.

## Run locally

Requirements: Bun 1.3.5 or newer. Remote management also needs reachable Debian/Ubuntu VPS hosts with root or passwordless sudo, Python 3, curl, OpenSSL, iproute2, util-linux (`flock`) and systemd. Native binary deployment currently supports amd64 and arm64. Port hopping requires iptables and ip6tables. Install Hysteria 2 for end-to-end node probes and mihomo and sing-box for template validation on the management server. Configure their executable paths.

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
5. Copy or scan the user's HTTPS subscription link. The automatic link uses the client's User-Agent. Fixed links select mihomo YAML, sing-box JSON, or a Base64 Shadowrocket node list. Each user has independent subscription and VPN tokens.

Host and node configuration changes are deliberately separated: editing a node's network settings records the desired settings; inspect configuration drift and choose **Reapply configuration** to apply them. Service changes and upgrades may interrupt connections. User permission, token and quota changes use HTTP authentication and `/kick`, without restarting the service.

## Production

Run on a Linux server with systemd, sudo, rsync, and curl. Install Bun 1.3.5 or newer at `/usr/local/bin/bun`, Hysteria at `/usr/local/bin/hysteria`, mihomo at `/usr/local/bin/mihomo`, and sing-box at `/usr/local/bin/sing-box` for template validation. Copy the official executable binaries for your architecture to those paths.

From a writable checkout on the server, run as your deployment user with sudo access:

```bash
bash deploy/install.sh
```

The script installs locked dependencies, deploys the application to `/opt/jetyet`, and creates `/etc/jetyet/jetyet.config.json` interactively on first run. Enter the public HTTPS origin and accept `/var/lib/jetyet/jetyet.sqlite` for the SQLite database, or enter another file under `/var/lib/jetyet`. The script waits for Web to respond before starting the monitoring and operations workers.

To update, run from the same Git checkout you used to install Jetyet:

```bash
bash deploy/update.sh
```

The update script pulls the current branch with `git pull --ff-only` and runs the installer after a successful pull. The installer reuses the existing configuration and database, synchronizes the updated application to `/opt/jetyet`, and restarts the services. The update script prints the deployed commit after the installer succeeds. If your checkout predates `deploy/update.sh`, pull once to get the script.

If an existing configuration points outside `/var/lib/jetyet`, set its `database` field to the absolute production path before updating. If the old path contains data you need, stop all three services and migrate the SQLite database before changing the path. Keep its configuration and master key.

Use [deploy/Caddyfile](deploy/Caddyfile) with Caddy 2.8 or newer, or use [deploy/nginx.conf](deploy/nginx.conf) with Nginx. Replace `network.example.com` with the hostname from Jetyet's public origin. For Caddy, add the site block to your active Caddyfile, point public DNS at the server, and allow inbound TCP ports 80 and 443 for automatic HTTPS. For Nginx, set the trusted certificate paths. Both examples proxy to the default Web listener at `127.0.0.1:3000`.

HTTPS protects login, subscription and installation downloads, and authentication callbacks. In every proxy or CDN in front of Jetyet, disable request-path logging for `/sub/`, `/deploy/`, and `/auth/hysteria/` because those paths contain secrets. Keep Caddy debug logging disabled to avoid recording those URLs in runtime logs. Add the `/deploy/` logging exclusion to existing proxies before issuing manual installation links. Access the loopback-bound VPN Traffic Stats API over SSH.

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

Save drafts while editing, including incomplete configurations. Publication checks the rendered configuration with the matching core. Set `mihomoBinary` and `singBoxBinary` to the management host's executable paths. Publish a **complete** configuration with DNS, outbound selection, and routing. Downloads require at least one eligible assigned node. Subscription downloads render the published template using current authorizations and credentials and check the resulting structure in-process.

## Development checks

```sh
bun run typecheck
bun run build
```

Test cases are intended for cloud CI; do not run them during local development unless necessary. GitHub Actions runs unit/integration cases, type checks, and the frontend build. Real SSH deployment, provider firewalls, IPv6 routing, actual node performance, and the 50-host/100-user/200-client capacity target require validation against deployment infrastructure.

See [CONTEXT.md](CONTEXT.md) for domain rules and [docs/deployment.md](docs/deployment.md) for agreed deployment requirements.
