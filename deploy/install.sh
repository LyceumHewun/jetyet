#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
install_dir=/opt/jetyet
state_dir=/var/lib/jetyet
config_dir=/etc/jetyet
config=$config_dir/jetyet.config.json
bun=/usr/local/bin/bun
services=(jetyet-web.service jetyet-monitor.service jetyet-operations.service)

(( EUID != 0 )) || fail "Run this script as your deployment user with sudo access."
for command in sudo systemctl rsync curl; do
  command -v "$command" >/dev/null || fail "Install $command before deploying Jetyet."
done
for binary in "$bun" /usr/local/bin/hysteria /usr/local/bin/mihomo; do
  [[ -f "$binary" && -x "$binary" && ! -L "$binary" ]] ||
    fail "Install the executable binary at $binary."
done
[[ ! -L "$install_dir" ]] || fail "$install_dir must be a real directory."

cd "$project_dir"
"$bun" install --frozen-lockfile

if ! id jetyet >/dev/null 2>&1; then
  sudo useradd --system --user-group --home-dir "$state_dir" --shell /usr/sbin/nologin jetyet
fi
sudo install -d -o jetyet -g jetyet -m 0700 "$state_dir" "$config_dir"
for binary in "$bun" /usr/local/bin/hysteria /usr/local/bin/mihomo; do
  sudo -u jetyet test -x "$binary" || fail "The jetyet service account must be able to execute $binary."
done
sudo -u jetyet "$bun" --version >/dev/null

read_web_url() {
  sudo -u jetyet "$bun" -e '
  import { readFileSync } from "node:fs";
  import { dirname, resolve } from "node:path";
  const path = process.argv[1];
  const config = JSON.parse(readFileSync(path, "utf8"));
  const database = resolve(dirname(path), config.database ?? "./data/jetyet.sqlite");
  if (!database.startsWith("/var/lib/jetyet/")) {
    throw Error("Set database in " + path + " to an SQLite file under /var/lib/jetyet.");
  }
  const listen = config.listen ?? "127.0.0.1";
  const host = listen === "0.0.0.0" ? "127.0.0.1" : listen === "::" ? "[::1]" :
    listen.includes(":") ? "[" + listen + "]" : listen;
  console.log("http://" + host + ":" + (config.port ?? 3000) + "/");
' -- "$config"
}

if sudo test -e "$config"; then
  web_url=$(cd / && read_web_url) || fail "Check $config before continuing."
fi

for service in "${services[@]:1}" "${services[0]}"; do
  if [[ -f "/etc/systemd/system/$service" ]]; then
    sudo systemctl stop "$service"
  fi
done
if [[ "$project_dir" != "$install_dir" ]]; then
  sudo install -d -o root -g root -m 0755 "$install_dir"
  sudo rsync -a --delete --chown=root:root --chmod=D755,Fgo+r,Fgo-w \
    src scripts node_modules package.json bun.lock "$install_dir/"
fi
sudo -u jetyet sh -c 'cd "$1" && test -r src/server/index.ts' sh "$install_dir" ||
  fail "The jetyet service account must be able to read $install_dir."

if [[ -z "${web_url:-}" ]]; then
  (
    cd "$install_dir"
    sudo -u jetyet env NODE_ENV=production JETYET_CONFIG="$config" "$bun" scripts/setup.ts
  )
  web_url=$(cd / && read_web_url) || fail "Check $config before continuing."
fi

sudo install -m 0644 "${services[@]/#/deploy/}" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start jetyet-web.service

for ((attempt = 0; attempt < 30; attempt++)); do
  if curl --noproxy '*' --silent --fail --max-time 2 "$web_url" >/dev/null; then
    sudo systemctl enable --now "${services[@]}"
    systemctl --no-pager is-active "${services[@]}"
    exit 0
  fi
  sleep 1
done
sudo journalctl -u jetyet-web.service -n 30 --no-pager
fail "Jetyet Web did not respond at $web_url."
