# Native control plane with SQLite-backed workers

Run Web, monitoring and remote operations as three native Bun processes on one cloud server, coordinated through SQLite WAL and persisted task leases. This avoids a separate broker while keeping deployments from delaying traffic collection and urgent connection revocation; configuration changes serialize per VPS. Native systemd services host at most one instance of each VPN protocol per VPS, excluding container-based deployment at the owner's request.
