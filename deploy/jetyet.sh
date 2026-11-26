#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_REPO="LyceumHewun/jetyet"
readonly DEFAULT_REF="main"
readonly INSTALL_DIR="/opt/jetyet"
readonly STATE_DIR="/var/lib/jetyet"
readonly CONFIG_DIR="/etc/jetyet"
readonly CONFIG_FILE="${CONFIG_DIR}/jetyet.config.json"
readonly CLI_PATH="/usr/local/bin/jetyet"
readonly META_DIR="/var/lib/jetyet-installer"
readonly MANIFEST_FILE="${META_DIR}/manifest"
readonly SERVICE_USER="jetyet"
readonly SERVICES=(
  "jetyet-web.service"
  "jetyet-monitor.service"
  "jetyet-operations.service"
)

readonly BUN_BIN="/usr/local/bin/bun"
readonly HYSTERIA_BIN="/usr/local/bin/hysteria"
readonly MIHOMO_BIN="/usr/local/bin/mihomo"
readonly SINGBOX_BIN="/usr/local/bin/sing-box"

readonly MIN_BUN_VERSION="1.3.5"
readonly MIN_HYSTERIA_VERSION="2.12.3"
readonly MIN_SINGBOX_VERSION="1.13.0"

REPO="${JETYET_REPO:-$DEFAULT_REPO}"
REF="${JETYET_REF:-$DEFAULT_REF}"
REPO_EXPLICIT=0
REF_EXPLICIT=0
[[ -n "${JETYET_REPO:-}" ]] && REPO_EXPLICIT=1
[[ -n "${JETYET_REF:-}" ]] && REF_EXPLICIT=1

GH_PROXY="${GH_PROXY:-}"
SKIP_CHECKSUM="${JETYET_SKIP_CHECKSUM:-0}"
WITH_DEPS=0
PURGE=0
REMOVE_DEPS=0
ASSUME_YES=0
ACTION=""

ARCH=""
HAS_AVX2=0
HAS_X86_V2=0
HAS_X86_V3=0

WORK_DIR=""
UNPRIV_WORK_DIR=""
PRESERVE_WORK_DIR=0
STAGE_NEXT=""
BACKUP_DIR=""
LOCK_FD=""

TX_ACTIVE=0
TX_ROLLING_BACK=0
TX_INSTALLED_NEW_DIR=0
TX_PREV_UNITS_DIR=""
TX_PREV_DEPS_DIR=""
TX_PREV_CLI_FILE=""
TX_PREV_CLI_EXISTED=0
TX_WEB_URL=""
declare -A TX_PREV_UNIT_EXISTS=()
declare -A TX_PREV_UNIT_ENABLED=()
declare -A TX_PREV_UNIT_ACTIVE=()
declare -A TX_DEP_EXISTED=()
declare -A TX_DEP_PREV_SHA=()

STAGED_DEPS_DIR=""
STAGED_BUN_BIN=""
declare -A STAGED_DEP_BIN=()
declare -A STAGED_DEP_SHA=()

declare -A MANIFEST_DEP_SHA=()
MANIFEST_CREATED_USER=0
SESSION_CREATED_USER=0

PREPARED_SRC_DIR=""
PREPARED_COMMIT=""

info() {
  printf '[jetyet] %s\n' "$*"
}

warn() {
  printf '[jetyet] WARNING: %s\n' "$*" >&2
}

fail() {
  printf '[jetyet] ERROR: %s\n' "$*" >&2
  exit 1
}

on_signal() {
  local sig="$1"
  warn "Interrupted by SIG${sig}."
  exit 130
}

cleanup() {
  local exit_code=$?
  set +e
  if ((TX_ACTIVE == 1 && TX_ROLLING_BACK == 0)); then
    rollback_transaction
  fi
  if [[ -n "$STAGE_NEXT" && -d "$STAGE_NEXT" ]]; then
    run_root rm -rf "$STAGE_NEXT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    if ((PRESERVE_WORK_DIR == 1)); then
      warn "Preserved recovery artifacts in ${WORK_DIR}."
    else
      rm -rf "$WORK_DIR" >/dev/null 2>&1 || run_root rm -rf "$WORK_DIR" >/dev/null 2>&1 || true
    fi
  fi
  exit "$exit_code"
}

trap cleanup EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP

usage() {
  cat <<EOF
Jetyet Linux deployment manager

Usage:
  jetyet [command] [options]
  curl -fsSL https://raw.githubusercontent.com/${DEFAULT_REPO}/${DEFAULT_REF}/deploy/jetyet.sh | bash
  curl -fsSL https://raw.githubusercontent.com/${DEFAULT_REPO}/${DEFAULT_REF}/deploy/jetyet.sh | bash -s -- <command> [options]

Commands:
  install       Download dependencies and deploy Jetyet
  upgrade       Upgrade Jetyet (preserves config/DB; rolls back atomically on failure)
  uninstall     Stop services and remove Jetyet (preserves config/data/deps by default)
  status        Show installed release, service state, and dependency versions
  help          Show this help message

Options:
  --ref <ref>               Git branch, tag, or commit SHA to deploy (default: ${DEFAULT_REF}, or previous ref on upgrade)
  --repo <owner/repo>       GitHub repository (default: ${DEFAULT_REPO}, or previous repo on upgrade)
  --gh-proxy <url>          GitHub download proxy prefix (or env GH_PROXY)
  --with-deps               Upgrade Bun, Hysteria 2, mihomo, and sing-box during upgrade
  --insecure-skip-checksum  Allow dependency downloads when official SHA-256 metadata is unreachable
  --purge                   With uninstall: permanently delete ${CONFIG_DIR}, ${STATE_DIR}, and script-created user ${SERVICE_USER}
  --remove-deps             With uninstall: remove unmodified binaries installed by this script
  -y, --yes                 Skip confirmation prompts
  -h, --help                Show this help message

Environment overrides:
  JETYET_REPO, JETYET_REF, GH_PROXY, JETYET_SKIP_CHECKSUM,
  BUN_VERSION, HYSTERIA_VERSION, MIHOMO_VERSION, SING_BOX_VERSION
EOF
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      install | upgrade | uninstall | status | help)
        [[ -z "$ACTION" ]] || fail "Multiple commands specified: $ACTION and $1"
        ACTION="$1"
        shift
        ;;
      --ref)
        (($# >= 2)) || fail "--ref requires a value"
        REF="$2"
        REF_EXPLICIT=1
        shift 2
        ;;
      --repo)
        (($# >= 2)) || fail "--repo requires a value"
        REPO="$2"
        REPO_EXPLICIT=1
        shift 2
        ;;
      --gh-proxy)
        (($# >= 2)) || fail "--gh-proxy requires a value"
        GH_PROXY="$2"
        shift 2
        ;;
      --with-deps)
        WITH_DEPS=1
        shift
        ;;
      --insecure-skip-checksum)
        SKIP_CHECKSUM=1
        shift
        ;;
      --purge)
        PURGE=1
        shift
        ;;
      --remove-deps)
        REMOVE_DEPS=1
        shift
        ;;
      -y | --yes)
        ASSUME_YES=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1 (run with --help for usage)"
        ;;
    esac
  done

  GH_PROXY="${GH_PROXY%/}"
}

has_tty() {
  (: >/dev/tty && : </dev/tty) 2>/dev/null
}

prompt_tty() {
  local prompt="$1"
  local var_name="$2"
  local reply=""
  has_tty || fail "Interactive input required, but no controlling terminal (/dev/tty) is available."
  printf '%s' "$prompt" >/dev/tty
  IFS= read -r reply </dev/tty || reply=""
  printf -v "$var_name" '%s' "$reply"
}

confirm_tty() {
  local prompt="$1"
  local answer=""
  prompt_tty "${prompt} [y/N]: " answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

run_root() {
  if ((EUID == 0)); then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_jetyet() {
  if ((EUID == 0)); then
    if command -v runuser >/dev/null 2>&1; then
      runuser -u "$SERVICE_USER" -- "$@"
    elif command -v sudo >/dev/null 2>&1; then
      sudo -u "$SERVICE_USER" -- "$@"
    else
      fail "Install runuser (util-linux) or sudo to run commands as ${SERVICE_USER}."
    fi
  else
    sudo -u "$SERVICE_USER" -- "$@"
  fi
}

run_unprivileged() {
  if ((EUID == 0)); then
    run_as_jetyet "$@"
  else
    "$@"
  fi
}

ensure_privilege() {
  if ((EUID == 0)); then
    return 0
  fi
  command -v sudo >/dev/null 2>&1 || fail "Run as root or install sudo."
  if ! sudo -n true >/dev/null 2>&1; then
    has_tty || fail "sudo requires a password, but no controlling terminal is available (configure passwordless sudo or run interactively)."
    sudo -v </dev/tty || fail "Unable to obtain sudo privileges."
  fi
}

acquire_lock() {
  local lock_file="/run/jetyet-deploy.lock"
  if [[ ! -d /run ]]; then
    run_root install -d -o root -g root -m 0755 "$META_DIR"
    lock_file="${META_DIR}/deploy.lock"
  fi
  run_root sh -c '
    set -eu
    lock="$1"
    if [ -L "$lock" ]; then
      exit 1
    fi
    if [ ! -f "$lock" ]; then
      umask 022
      (set -C; : > "$lock") 2>/dev/null || [ -f "$lock" ]
    fi
    [ -f "$lock" ] && [ ! -L "$lock" ]
  ' sh "$lock_file" || fail "Invalid lock path: ${lock_file}"
  exec {LOCK_FD}<"$lock_file"
  flock -n "$LOCK_FD" || fail "Another Jetyet deployment operation is already running (lock: ${lock_file})."
}

cpu_has_flag() {
  local flag="$1"
  grep -qm1 -E "^flags[[:space:]]*:.*\\b${flag}\\b" /proc/cpuinfo
}

detect_platform() {
  [[ "$(uname -s)" == "Linux" ]] || fail "Jetyet deployment supports Linux only."
  command -v systemctl >/dev/null 2>&1 || fail "systemd (systemctl) is required."

  case "$(uname -m)" in
    x86_64 | amd64)
      ARCH="amd64"
      if [[ -r /proc/cpuinfo ]]; then
        if cpu_has_flag "avx2"; then
          HAS_AVX2=1
        fi
        if cpu_has_flag "cx16" &&
          cpu_has_flag "lahf_lm" &&
          cpu_has_flag "popcnt" &&
          cpu_has_flag "sse4_1" &&
          cpu_has_flag "sse4_2" &&
          cpu_has_flag "ssse3"; then
          HAS_X86_V2=1
        fi
        if ((HAS_X86_V2 == 1)) &&
          cpu_has_flag "avx" &&
          cpu_has_flag "avx2" &&
          cpu_has_flag "bmi1" &&
          cpu_has_flag "bmi2" &&
          cpu_has_flag "f16c" &&
          cpu_has_flag "fma" &&
          cpu_has_flag "movbe" &&
          cpu_has_flag "xsave" &&
          { cpu_has_flag "abm" || cpu_has_flag "lzcnt"; }; then
          HAS_X86_V3=1
        fi
      fi
      ;;
    aarch64 | arm64)
      ARCH="arm64"
      ;;
    *)
      fail "Unsupported CPU architecture: $(uname -m). Supported: amd64, arm64."
      ;;
  esac
}

require_base_tools() {
  local missing=()
  local cmd
  for cmd in curl tar gzip find sed grep awk install flock; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    missing+=("sha256sum")
  fi
  if ! command -v useradd >/dev/null 2>&1 && ! run_root sh -c 'command -v useradd >/dev/null 2>&1'; then
    missing+=("useradd")
  fi
  if ((${#missing[@]} > 0)); then
    fail "Missing required tools: ${missing[*]}. Install them and retry."
  fi
}

require_uninstall_tools() {
  local missing=()
  local cmd
  for cmd in awk install flock; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    missing+=("sha256sum")
  fi
  if ((${#missing[@]} > 0)); then
    fail "Missing required tools: ${missing[*]}. Install them and retry."
  fi
}

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

ensure_work_dir() {
  if [[ -z "$WORK_DIR" ]]; then
    WORK_DIR=$(mktemp -d "/tmp/jetyet-deploy.XXXXXX")
    chmod 0755 "$WORK_DIR"
    STAGED_DEPS_DIR="${WORK_DIR}/staged-deps"
    mkdir -p "$STAGED_DEPS_DIR"
    chmod 0755 "$STAGED_DEPS_DIR"
    UNPRIV_WORK_DIR="${WORK_DIR}/unpriv"
    mkdir -p "$UNPRIV_WORK_DIR"
    if ((EUID == 0)) && id "$SERVICE_USER" >/dev/null 2>&1; then
      chown "${SERVICE_USER}:${SERVICE_USER}" "$UNPRIV_WORK_DIR"
      chmod 0700 "$UNPRIV_WORK_DIR"
    fi
  fi
}

github_url() {
  local raw="$1"
  if [[ -n "$GH_PROXY" ]]; then
    printf '%s/%s\n' "$GH_PROXY" "$raw"
  else
    printf '%s\n' "$raw"
  fi
}

try_download_url() {
  local url="$1"
  local dest="$2"
  curl -fLsS --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 \
    -o "$dest" "$url"
}

try_download_file() {
  local raw_url="$1"
  local dest="$2"
  local url
  url=$(github_url "$raw_url")
  try_download_url "$url" "$dest"
}

download_file() {
  local raw_url="$1"
  local dest="$2"
  local url
  url=$(github_url "$raw_url")
  try_download_url "$url" "$dest" || fail "Failed to download ${url}"
}

require_zip_extractor() {
  command -v unzip >/dev/null 2>&1 ||
    command -v bsdtar >/dev/null 2>&1 ||
    command -v python3 >/dev/null 2>&1 ||
    fail "Missing zip extractor (unzip, bsdtar, or python3). Install unzip (e.g. apt-get install -y unzip) and retry."
}

extract_zip() {
  local zip_file="$1"
  local dest_dir="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$zip_file" -d "$dest_dir"
  elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$zip_file" -C "$dest_dir"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$zip_file" "$dest_dir"
  else
    return 1
  fi
}

version_ge() {
  local current="${1#v}"
  local required="${2#v}"
  local c1=0 c2=0 c3=0 r1=0 r2=0 r3=0
  IFS=. read -r c1 c2 c3 _ <<<"${current%%-*}"
  IFS=. read -r r1 r2 r3 _ <<<"${required%%-*}"
  c1=$((10#${c1:-0}))
  c2=$((10#${c2:-0}))
  c3=$((10#${c3:-0}))
  r1=$((10#${r1:-0}))
  r2=$((10#${r2:-0}))
  r3=$((10#${r3:-0}))

  if ((c1 != r1)); then
    ((c1 > r1))
    return
  fi
  if ((c2 != r2)); then
    ((c2 > r2))
    return
  fi
  ((c3 >= r3))
}

resolve_latest_tag() {
  local repo="$1"
  local raw="https://github.com/${repo}/releases/latest"
  local candidates=("$raw")
  if [[ -n "$GH_PROXY" ]]; then
    candidates=("$(github_url "$raw")" "$raw")
  fi
  local url effective tag=""

  for url in "${candidates[@]}"; do
    effective=$(curl -fsSIL --connect-timeout 15 --max-time 30 \
      -o /dev/null -w '%{url_effective}' "$url" 2>/dev/null || true)
    if [[ "$effective" == *"/releases/tag/"* ]]; then
      tag="${effective##*/releases/tag/}"
      break
    fi
  done

  if [[ -z "$tag" ]]; then
    for url in "${candidates[@]}"; do
      effective=$(curl -fsSL --connect-timeout 15 --max-time 30 \
        -o /dev/null -w '%{url_effective}' "$url" 2>/dev/null || true)
      if [[ "$effective" == *"/releases/tag/"* ]]; then
        tag="${effective##*/releases/tag/}"
        break
      fi
    done
  fi

  [[ -n "$tag" ]] || return 1
  tag="${tag%%\?*}"
  tag="${tag%%#*}"
  tag="${tag%/}"
  tag="${tag//%2F/\/}"
  tag="${tag//%2f/\/}"
  printf '%s\n' "$tag"
}

extract_hysteria_app_tag_from_json() {
  local json_file="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$json_file" <<'PY'
import json, re, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
for rel in data:
    if rel.get("draft") or rel.get("prerelease"):
        continue
    tag = rel.get("tag_name", "")
    m = re.match(r"^app/v(\d+\.\d+\.\d+)$", tag)
    if m:
        print(m.group(1))
        sys.exit(0)
sys.exit(1)
PY
    return $?
  fi

  awk '
    /"tag_name"[[:space:]]*:/ {
      tag = $0
      sub(/.*"tag_name"[[:space:]]*:[[:space:]]*"/, "", tag)
      sub(/".*/, "", tag)
      draft = 0; pre = 0
    }
    /"draft"[[:space:]]*:[[:space:]]*true/ { draft = 1 }
    /"prerelease"[[:space:]]*:[[:space:]]*true/ { pre = 1 }
    /"assets"[[:space:]]*:/ {
      if (!draft && !pre && tag ~ /^app\/v[0-9]+\.[0-9]+\.[0-9]+$/) {
        sub(/^app\/v/, "", tag)
        print tag
        exit 0
      }
    }
  ' "$json_file"
}

resolve_hysteria_version() {
  if [[ -n "${HYSTERIA_VERSION:-}" ]]; then
    local v="${HYSTERIA_VERSION#app/}"
    printf '%s\n' "${v#v}"
    return 0
  fi

  local tag=""
  if tag=$(resolve_latest_tag "apernet/hysteria") &&
    [[ "$tag" =~ ^app/v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  local api_raw="https://api.github.com/repos/apernet/hysteria/releases?per_page=15"
  local api_json="${WORK_DIR}/hysteria-releases.json"
  local candidates=("$api_raw")
  if [[ -n "$GH_PROXY" ]]; then
    candidates=("$api_raw" "$(github_url "$api_raw")")
  fi

  local url api_ver=""
  for url in "${candidates[@]}"; do
    if curl -fsSL --connect-timeout 15 --max-time 30 -o "$api_json" "$url" 2>/dev/null; then
      api_ver=$(extract_hysteria_app_tag_from_json "$api_json" 2>/dev/null || true)
      if [[ -n "$api_ver" ]]; then
        printf '%s\n' "$api_ver"
        return 0
      fi
    fi
  done

  fail "Unable to resolve latest stable Hysteria 2 app release."
}

extract_asset_digest_from_json() {
  local json_file="$1"
  local asset_name="$2"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$json_file" "$asset_name" <<'PY'
import json, re, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
target = sys.argv[2]
for asset in data.get("assets", []):
    if asset.get("name") == target:
        digest = asset.get("digest") or ""
        m = re.match(r"^sha256:([0-9a-fA-F]{64})$", digest)
        if m:
            print(m.group(1).lower())
            sys.exit(0)
sys.exit(1)
PY
    return $?
  fi

  awk -v target="$asset_name" '
    /"name"[[:space:]]*:/ {
      name = $0
      sub(/.*"name"[[:space:]]*:[[:space:]]*"/, "", name)
      sub(/".*/, "", name)
      matched = (name == target)
      next
    }
    matched && /"digest"[[:space:]]*:/ {
      if ($0 ~ /"digest"[[:space:]]*:[[:space:]]*"sha256:[0-9a-fA-F]{64}"/) {
        d = $0
        sub(/.*"digest"[[:space:]]*:[[:space:]]*"sha256:/, "", d)
        sub(/".*/, "", d)
        print tolower(d)
        exit 0
      }
      matched = 0
    }
  ' "$json_file"
}

fetch_release_api_json() {
  local repo="$1"
  local tag="$2"
  local cache_key="${repo//\//_}_${tag//\//_}"
  local out_file="${WORK_DIR}/release_${cache_key}.json"
  if [[ -s "$out_file" ]]; then
    printf '%s\n' "$out_file"
    return 0
  fi
  local encoded_tag="${tag//\//%2F}"
  local raw="https://api.github.com/repos/${repo}/releases/tags/${encoded_tag}"
  if curl -fsSL --connect-timeout 15 --max-time 30 -o "$out_file" "$raw" 2>/dev/null; then
    printf '%s\n' "$out_file"
    return 0
  fi
  rm -f "$out_file"
  return 1
}

fetch_checksum_from_txt() {
  local raw_url="$1"
  local asset_name="$2"
  local cache_file="$3"
  if [[ ! -s "$cache_file" ]]; then
    if ! curl -fsSL --connect-timeout 15 --max-time 30 -o "$cache_file" "$raw_url" 2>/dev/null; then
      rm -f "$cache_file"
      return 1
    fi
  fi

  awk -v asset="$asset_name" '
    $1 ~ /^[0-9a-fA-F]{64}$/ {
      file = $2
      sub(/^\*/, "", file)
      sub(/^.*\//, "", file)
      if (file == asset) {
        print tolower($1)
        exit 0
      }
    }
  ' "$cache_file"
}

verify_asset_checksum() {
  local repo="$1"
  local tag="$2"
  local asset_name="$3"
  local file_path="$4"
  local checksum_txt_name="${5:-}"
  local expected=""
  local api_json=""

  if api_json=$(fetch_release_api_json "$repo" "$tag"); then
    expected=$(extract_asset_digest_from_json "$api_json" "$asset_name" 2>/dev/null || true)
  fi

  if [[ -z "$expected" && -n "$checksum_txt_name" ]]; then
    local txt_url="https://github.com/${repo}/releases/download/${tag}/${checksum_txt_name}"
    local txt_cache="${WORK_DIR}/sum_${repo//\//_}_${tag//\//_}_${checksum_txt_name}"
    expected=$(fetch_checksum_from_txt "$txt_url" "$asset_name" "$txt_cache" 2>/dev/null || true)
  fi

  if [[ -z "$expected" ]]; then
    if ((SKIP_CHECKSUM == 1)); then
      warn "Skipping SHA-256 verification for ${asset_name} (--insecure-skip-checksum / JETYET_SKIP_CHECKSUM=1)."
      return 0
    fi
    warn "Unable to obtain official SHA-256 digest for ${asset_name} (${repo}@${tag}). Pass --insecure-skip-checksum to bypass."
    return 1
  fi

  local actual
  actual=$(sha256_file "$file_path")
  if [[ "${actual,,}" != "${expected,,}" ]]; then
    warn "SHA-256 mismatch for ${asset_name}: expected ${expected}, got ${actual}."
    return 1
  fi
  info "SHA-256 verified for ${asset_name}."
  return 0
}

read_bun_version_from_bin() {
  local bin="$1"
  local out
  out=$("$bin" --version 2>/dev/null) || return 1
  local ver
  ver=$(printf '%s\n' "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)
  [[ -n "$ver" ]] || return 1
  printf '%s\n' "$ver"
}

read_hysteria_version_from_bin() {
  local bin="$1"
  local out
  out=$("$bin" version 2>/dev/null) || return 1
  local ver
  ver=$(printf '%s\n' "$out" | grep -oE 'v2\.[0-9]+\.[0-9]+' | head -n 1 | sed 's/^v//' || true)
  [[ -n "$ver" ]] || return 1
  printf '%s\n' "$ver"
}

read_mihomo_version_from_bin() {
  local bin="$1"
  local out
  out=$("$bin" -v 2>/dev/null) || return 1
  local ver
  ver=$(printf '%s\n' "$out" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 | sed 's/^v//' || true)
  [[ -n "$ver" ]] || return 1
  printf '%s\n' "$ver"
}

read_singbox_version_from_bin() {
  local bin="$1"
  local out
  out=$("$bin" version 2>/dev/null) || return 1
  local ver
  ver=$(printf '%s\n' "$out" | head -n 1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)
  [[ -n "$ver" ]] || return 1
  printf '%s\n' "$ver"
}

installed_bun_version() {
  [[ -f "$BUN_BIN" && -x "$BUN_BIN" && ! -L "$BUN_BIN" ]] || return 1
  read_bun_version_from_bin "$BUN_BIN"
}

installed_hysteria_version() {
  [[ -f "$HYSTERIA_BIN" && -x "$HYSTERIA_BIN" && ! -L "$HYSTERIA_BIN" ]] || return 1
  read_hysteria_version_from_bin "$HYSTERIA_BIN"
}

installed_mihomo_version() {
  [[ -f "$MIHOMO_BIN" && -x "$MIHOMO_BIN" && ! -L "$MIHOMO_BIN" ]] || return 1
  read_mihomo_version_from_bin "$MIHOMO_BIN"
}

installed_singbox_version() {
  [[ -f "$SINGBOX_BIN" && -x "$SINGBOX_BIN" && ! -L "$SINGBOX_BIN" ]] || return 1
  read_singbox_version_from_bin "$SINGBOX_BIN"
}

load_manifest() {
  MANIFEST_DEP_SHA=()
  MANIFEST_CREATED_USER=0
  if run_root test -f "$MANIFEST_FILE"; then
    local kind key val
    while IFS=' ' read -r kind key val; do
      case "$kind" in
        DEP)
          [[ -n "$key" && -n "$val" ]] && MANIFEST_DEP_SHA["$key"]="$val"
          ;;
        CREATED_USER)
          [[ "$key" == "1" ]] && MANIFEST_CREATED_USER=1
          ;;
      esac
    done < <(run_root cat "$MANIFEST_FILE")
  fi
}

write_manifest_atomic() {
  local tmp="${WORK_DIR}/manifest.next"
  : >"$tmp"
  if ((MANIFEST_CREATED_USER == 1 || SESSION_CREATED_USER == 1)); then
    printf 'CREATED_USER 1\n' >>"$tmp"
  else
    printf 'CREATED_USER 0\n' >>"$tmp"
  fi
  local dep
  for dep in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    if [[ -n "${MANIFEST_DEP_SHA[$dep]:-}" ]]; then
      printf 'DEP %s %s\n' "$dep" "${MANIFEST_DEP_SHA[$dep]}" >>"$tmp"
    fi
  done

  run_root install -d -o root -g root -m 0755 "$META_DIR"
  run_root install -o root -g root -m 0644 "$tmp" "${MANIFEST_FILE}.tmp.$$"
  run_root mv "${MANIFEST_FILE}.tmp.$$" "$MANIFEST_FILE"
}

stage_bun() {
  local force="${1:-0}"
  local pinned=0
  local target_ver=""
  if [[ -n "${BUN_VERSION:-}" ]]; then
    pinned=1
    target_ver="${BUN_VERSION#bun-}"
    target_ver="${target_ver#v}"
    version_ge "$target_ver" "$MIN_BUN_VERSION" ||
      fail "Requested Bun version ${target_ver} is older than required ${MIN_BUN_VERSION}."
  fi

  local current=""
  current=$(installed_bun_version 2>/dev/null || true)

  if ((pinned == 1)); then
    if ((force == 0)) && [[ "$current" == "$target_ver" ]]; then
      info "Bun ${current} already matches pinned BUN_VERSION=${target_ver}; skipping."
      STAGED_BUN_BIN="$BUN_BIN"
      return 0
    fi
  elif ((force == 0)) && [[ -n "$current" ]] && version_ge "$current" "$MIN_BUN_VERSION"; then
    info "Bun ${current} already satisfies >= ${MIN_BUN_VERSION}; skipping."
    STAGED_BUN_BIN="$BUN_BIN"
    return 0
  fi

  local ver="$target_ver"
  if [[ -z "$ver" ]]; then
    local tag
    tag=$(resolve_latest_tag "oven-sh/bun") || fail "Unable to resolve latest Bun release."
    ver="${tag#bun-}"
    ver="${ver#v}"
    version_ge "$ver" "$MIN_BUN_VERSION" ||
      fail "Resolved Bun version ${ver} is older than required ${MIN_BUN_VERSION}."
  fi

  require_zip_extractor

  local variants=()
  if [[ "$ARCH" == "amd64" ]]; then
    if ((HAS_AVX2 == 1)); then
      variants=("bun-linux-x64.zip" "bun-linux-x64-baseline.zip")
    else
      variants=("bun-linux-x64-baseline.zip")
    fi
  else
    variants=("bun-linux-aarch64.zip")
  fi

  local variant zip_path extract_dir bin_candidate probe_bin installed_ver=""
  for variant in "${variants[@]}"; do
    info "Downloading Bun v${ver} (${variant})..."
    zip_path="${WORK_DIR}/${variant}"
    extract_dir="${WORK_DIR}/bun-${variant%.zip}"
    rm -rf "$extract_dir"
    mkdir -p "$extract_dir"
    if ! try_download_file "https://github.com/oven-sh/bun/releases/download/bun-v${ver}/${variant}" "$zip_path"; then
      warn "Failed to download ${variant}; trying next variant if available..."
      continue
    fi
    if ! verify_asset_checksum "oven-sh/bun" "bun-v${ver}" "$variant" "$zip_path" "SHASUMS256.txt"; then
      warn "Checksum verification failed for ${variant}; trying next variant if available..."
      continue
    fi
    if ! extract_zip "$zip_path" "$extract_dir"; then
      warn "Failed to extract ${variant}; trying next variant if available..."
      continue
    fi
    bin_candidate=$(find "$extract_dir" -type f -name bun | head -n 1)
    if [[ -z "$bin_candidate" ]]; then
      warn "Bun binary not found inside ${variant}."
      continue
    fi
    probe_bin="${UNPRIV_WORK_DIR}/bun"
    install -m 0755 "$bin_candidate" "$probe_bin"
    ((EUID == 0)) && chown "${SERVICE_USER}:${SERVICE_USER}" "$probe_bin"

    local out
    if out=$(run_unprivileged "$probe_bin" --version 2>/dev/null) &&
      installed_ver=$(printf '%s\n' "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1) &&
      [[ -n "$installed_ver" ]]; then
      version_ge "$installed_ver" "$MIN_BUN_VERSION" ||
        fail "Downloaded Bun ${installed_ver} is older than required ${MIN_BUN_VERSION}."
      if ((pinned == 1)) && [[ "$installed_ver" != "$target_ver" ]]; then
        fail "Downloaded Bun version ${installed_ver} does not match pinned ${target_ver}."
      fi
      local staged="${STAGED_DEPS_DIR}/bun"
      install -m 0755 "$bin_candidate" "$staged"
      STAGED_DEP_BIN["$BUN_BIN"]="$staged"
      STAGED_DEP_SHA["$BUN_BIN"]=$(sha256_file "$staged")
      STAGED_BUN_BIN="$staged"
      info "Staged Bun ${installed_ver}."
      return 0
    fi
    warn "Bun binary from ${variant} failed to execute on this CPU; trying fallback..."
  done

  fail "Unable to stage a verified working Bun binary on this host."
}

stage_hysteria() {
  local force="${1:-0}"
  local pinned=0
  local target_ver=""
  if [[ -n "${HYSTERIA_VERSION:-}" ]]; then
    pinned=1
    target_ver="${HYSTERIA_VERSION#app/}"
    target_ver="${target_ver#v}"
    version_ge "$target_ver" "$MIN_HYSTERIA_VERSION" ||
      fail "Requested Hysteria 2 version v${target_ver} is older than required v${MIN_HYSTERIA_VERSION}."
  fi

  local current=""
  current=$(installed_hysteria_version 2>/dev/null || true)

  if ((pinned == 1)); then
    if ((force == 0)) && [[ "$current" == "$target_ver" ]]; then
      info "Hysteria 2 v${current} already matches pinned HYSTERIA_VERSION=${target_ver}; skipping."
      return 0
    fi
  elif ((force == 0)) && [[ -n "$current" ]] && version_ge "$current" "$MIN_HYSTERIA_VERSION"; then
    info "Hysteria 2 v${current} already satisfies >= v${MIN_HYSTERIA_VERSION}; skipping."
    return 0
  fi

  local ver="$target_ver"
  if [[ -z "$ver" ]]; then
    ver=$(resolve_hysteria_version)
    version_ge "$ver" "$MIN_HYSTERIA_VERSION" ||
      fail "Resolved Hysteria 2 version v${ver} is older than required v${MIN_HYSTERIA_VERSION}."
  fi

  local asset="hysteria-linux-${ARCH}"
  local bin_candidate="${WORK_DIR}/${asset}"
  info "Downloading Hysteria 2 v${ver} (${asset})..."
  download_file "https://github.com/apernet/hysteria/releases/download/app/v${ver}/${asset}" "$bin_candidate"
  verify_asset_checksum "apernet/hysteria" "app/v${ver}" "$asset" "$bin_candidate" "hashes.txt" ||
    fail "Checksum verification failed for ${asset}."

  local probe_bin="${UNPRIV_WORK_DIR}/hysteria"
  install -m 0755 "$bin_candidate" "$probe_bin"
  ((EUID == 0)) && chown "${SERVICE_USER}:${SERVICE_USER}" "$probe_bin"

  local out installed_ver
  out=$(run_unprivileged "$probe_bin" version 2>/dev/null) ||
    fail "Downloaded Hysteria 2 binary failed to execute."
  installed_ver=$(printf '%s\n' "$out" | grep -oE 'v2\.[0-9]+\.[0-9]+' | head -n 1 | sed 's/^v//' || true)
  [[ -n "$installed_ver" ]] || fail "Unable to parse version from downloaded Hysteria 2 binary."
  version_ge "$installed_ver" "$MIN_HYSTERIA_VERSION" ||
    fail "Downloaded Hysteria 2 v${installed_ver} is older than required v${MIN_HYSTERIA_VERSION}."
  if ((pinned == 1)) && [[ "$installed_ver" != "$target_ver" ]]; then
    fail "Downloaded Hysteria 2 v${installed_ver} does not match pinned v${target_ver}."
  fi

  local staged="${STAGED_DEPS_DIR}/hysteria"
  install -m 0755 "$bin_candidate" "$staged"
  STAGED_DEP_BIN["$HYSTERIA_BIN"]="$staged"
  STAGED_DEP_SHA["$HYSTERIA_BIN"]=$(sha256_file "$staged")
  info "Staged Hysteria 2 v${installed_ver}."
}

stage_mihomo() {
  local force="${1:-0}"
  local pinned=0
  local target_ver=""
  if [[ -n "${MIHOMO_VERSION:-}" ]]; then
    pinned=1
    target_ver="${MIHOMO_VERSION#v}"
  fi

  local current=""
  current=$(installed_mihomo_version 2>/dev/null || true)

  if ((pinned == 1)); then
    if ((force == 0)) && [[ "$current" == "$target_ver" ]]; then
      info "mihomo v${current} already matches pinned MIHOMO_VERSION=${target_ver}; skipping."
      return 0
    fi
  elif ((force == 0)) && [[ -n "$current" ]]; then
    info "mihomo v${current} already installed; skipping."
    return 0
  fi

  local ver="$target_ver"
  if [[ -z "$ver" ]]; then
    local tag
    tag=$(resolve_latest_tag "MetaCubeX/mihomo") || fail "Unable to resolve latest mihomo release."
    ver="${tag#v}"
  fi

  local assets=()
  if [[ "$ARCH" == "amd64" ]]; then
    if ((HAS_X86_V3 == 1)); then
      assets=(
        "mihomo-linux-amd64-v3-v${ver}.gz"
        "mihomo-linux-amd64-v2-v${ver}.gz"
        "mihomo-linux-amd64-compatible-v${ver}.gz"
      )
    elif ((HAS_X86_V2 == 1)); then
      assets=(
        "mihomo-linux-amd64-v2-v${ver}.gz"
        "mihomo-linux-amd64-compatible-v${ver}.gz"
      )
    else
      assets=("mihomo-linux-amd64-compatible-v${ver}.gz")
    fi
  else
    assets=("mihomo-linux-arm64-v${ver}.gz")
  fi

  local asset gz_path bin_candidate probe_bin out installed_ver=""
  for asset in "${assets[@]}"; do
    info "Downloading mihomo v${ver} (${asset})..."
    gz_path="${WORK_DIR}/${asset}"
    bin_candidate="${WORK_DIR}/${asset%.gz}"
    if ! try_download_file "https://github.com/MetaCubeX/mihomo/releases/download/v${ver}/${asset}" "$gz_path"; then
      warn "Failed to download ${asset}; trying next variant if available..."
      continue
    fi
    if ! verify_asset_checksum "MetaCubeX/mihomo" "v${ver}" "$asset" "$gz_path"; then
      warn "Checksum verification failed for ${asset}; trying next variant if available..."
      continue
    fi
    if ! gzip -dc "$gz_path" >"$bin_candidate"; then
      warn "Failed to decompress ${asset}; trying next variant if available..."
      continue
    fi

    probe_bin="${UNPRIV_WORK_DIR}/mihomo"
    install -m 0755 "$bin_candidate" "$probe_bin"
    ((EUID == 0)) && chown "${SERVICE_USER}:${SERVICE_USER}" "$probe_bin"

    if out=$(run_unprivileged "$probe_bin" -v 2>/dev/null) &&
      installed_ver=$(printf '%s\n' "$out" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 | sed 's/^v//') &&
      [[ -n "$installed_ver" ]]; then
      if ((pinned == 1)) && [[ "$installed_ver" != "$target_ver" ]]; then
        fail "Downloaded mihomo v${installed_ver} does not match pinned v${target_ver}."
      fi
      local staged="${STAGED_DEPS_DIR}/mihomo"
      install -m 0755 "$bin_candidate" "$staged"
      STAGED_DEP_BIN["$MIHOMO_BIN"]="$staged"
      STAGED_DEP_SHA["$MIHOMO_BIN"]=$(sha256_file "$staged")
      info "Staged mihomo v${installed_ver}."
      return 0
    fi
    warn "mihomo binary from ${asset} failed to execute on this CPU; trying fallback..."
  done

  fail "Unable to stage a verified working mihomo binary on this host."
}

stage_singbox() {
  local force="${1:-0}"
  local pinned=0
  local target_ver=""
  if [[ -n "${SING_BOX_VERSION:-}" ]]; then
    pinned=1
    target_ver="${SING_BOX_VERSION#v}"
    version_ge "$target_ver" "$MIN_SINGBOX_VERSION" ||
      fail "Requested sing-box version ${target_ver} is older than required ${MIN_SINGBOX_VERSION}."
  fi

  local current=""
  current=$(installed_singbox_version 2>/dev/null || true)

  if ((pinned == 1)); then
    if ((force == 0)) && [[ "$current" == "$target_ver" ]]; then
      info "sing-box ${current} already matches pinned SING_BOX_VERSION=${target_ver}; skipping."
      return 0
    fi
  elif ((force == 0)) && [[ -n "$current" ]] && version_ge "$current" "$MIN_SINGBOX_VERSION"; then
    info "sing-box ${current} already satisfies >= ${MIN_SINGBOX_VERSION}; skipping."
    return 0
  fi

  local ver="$target_ver"
  if [[ -z "$ver" ]]; then
    local tag
    tag=$(resolve_latest_tag "SagerNet/sing-box") || fail "Unable to resolve latest sing-box release."
    ver="${tag#v}"
    version_ge "$ver" "$MIN_SINGBOX_VERSION" ||
      fail "Resolved sing-box version ${ver} is older than required ${MIN_SINGBOX_VERSION}."
  fi

  local asset="sing-box-${ver}-linux-${ARCH}.tar.gz"
  local tar_path="${WORK_DIR}/${asset}"
  local extract_dir="${WORK_DIR}/sing-box"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"

  info "Downloading sing-box v${ver} (${asset})..."
  download_file "https://github.com/SagerNet/sing-box/releases/download/v${ver}/${asset}" "$tar_path"
  verify_asset_checksum "SagerNet/sing-box" "v${ver}" "$asset" "$tar_path" ||
    fail "Checksum verification failed for ${asset}."
  tar -xzf "$tar_path" -C "$extract_dir"

  local bin_candidate
  bin_candidate=$(find "$extract_dir" -type f -name sing-box | head -n 1)
  [[ -n "$bin_candidate" ]] || fail "sing-box binary not found inside ${asset}."

  local probe_bin="${UNPRIV_WORK_DIR}/sing-box"
  install -m 0755 "$bin_candidate" "$probe_bin"
  ((EUID == 0)) && chown "${SERVICE_USER}:${SERVICE_USER}" "$probe_bin"

  local out installed_ver
  out=$(run_unprivileged "$probe_bin" version 2>/dev/null) ||
    fail "Downloaded sing-box binary failed to execute."
  installed_ver=$(printf '%s\n' "$out" | head -n 1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)
  [[ -n "$installed_ver" ]] || fail "Unable to parse version from downloaded sing-box binary."
  version_ge "$installed_ver" "$MIN_SINGBOX_VERSION" ||
    fail "Downloaded sing-box ${installed_ver} is older than required ${MIN_SINGBOX_VERSION}."
  if ((pinned == 1)) && [[ "$installed_ver" != "$target_ver" ]]; then
    fail "Downloaded sing-box ${installed_ver} does not match pinned ${target_ver}."
  fi

  local staged="${STAGED_DEPS_DIR}/sing-box"
  install -m 0755 "$bin_candidate" "$staged"
  STAGED_DEP_BIN["$SINGBOX_BIN"]="$staged"
  STAGED_DEP_SHA["$SINGBOX_BIN"]=$(sha256_file "$staged")
  info "Staged sing-box ${installed_ver}."
}

stage_dependencies() {
  local force="${1:-0}"
  STAGED_BUN_BIN=""
  STAGED_DEP_BIN=()
  STAGED_DEP_SHA=()
  stage_bun "$force"
  stage_hysteria "$force"
  stage_mihomo "$force"
  stage_singbox "$force"
}

commit_staged_dependencies() {
  local dep staged
  for dep in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    staged="${STAGED_DEP_BIN[$dep]:-}"
    [[ -n "$staged" ]] || continue
    run_root install -o root -g root -m 0755 "$staged" "$dep"
    info "Installed $(basename "$dep") at ${dep}."
  done
}

verify_runtime_binaries() {
  local bin
  for bin in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    [[ -f "$bin" && -x "$bin" && ! -L "$bin" ]] || fail "Executable binary missing at ${bin}."
    run_as_jetyet test -x "$bin" || fail "The ${SERVICE_USER} account must be able to execute ${bin}."
  done

  local out v
  out=$(run_as_jetyet "$BUN_BIN" --version 2>/dev/null) ||
    fail "The ${SERVICE_USER} account failed to run ${BUN_BIN}."
  v=$(printf '%s\n' "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)
  [[ -n "$v" ]] && version_ge "$v" "$MIN_BUN_VERSION" ||
    fail "Bun ${v:-unknown} at ${BUN_BIN} is older than required ${MIN_BUN_VERSION}."

  out=$(run_as_jetyet "$HYSTERIA_BIN" version 2>/dev/null) ||
    fail "The ${SERVICE_USER} account failed to run ${HYSTERIA_BIN}."
  v=$(printf '%s\n' "$out" | grep -oE 'v2\.[0-9]+\.[0-9]+' | head -n 1 | sed 's/^v//' || true)
  [[ -n "$v" ]] && version_ge "$v" "$MIN_HYSTERIA_VERSION" ||
    fail "Hysteria 2 v${v:-unknown} at ${HYSTERIA_BIN} is older than required v${MIN_HYSTERIA_VERSION}."

  run_as_jetyet "$MIHOMO_BIN" -v >/dev/null 2>&1 ||
    fail "The ${SERVICE_USER} account failed to run ${MIHOMO_BIN}."

  out=$(run_as_jetyet "$SINGBOX_BIN" version 2>/dev/null) ||
    fail "The ${SERVICE_USER} account failed to run ${SINGBOX_BIN}."
  v=$(printf '%s\n' "$out" | head -n 1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)
  [[ -n "$v" ]] && version_ge "$v" "$MIN_SINGBOX_VERSION" ||
    fail "sing-box ${v:-unknown} at ${SINGBOX_BIN} is older than required ${MIN_SINGBOX_VERSION}."
}

ensure_service_account_and_dirs() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    info "Creating system user ${SERVICE_USER}..."
    run_root useradd --system --user-group --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
    SESSION_CREATED_USER=1
    ensure_work_dir
    write_manifest_atomic
  fi
  run_root install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR" "$CONFIG_DIR"
}

read_web_url() {
  local bun_exec="${1:-$BUN_BIN}"
  (
    cd /
    run_as_jetyet "$bun_exec" -e '
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
    ' -- "$CONFIG_FILE"
  )
}

extract_commit_from_tarball() {
  local tarball="$1"
  local commit=""
  commit=$(gzip -dc "$tarball" 2>/dev/null | head -c 4096 | grep -aoE 'comment=[0-9a-f]{40}' | head -n 1 | cut -d= -f2 || true)
  printf '%s\n' "${commit:-unknown}"
}

fetch_and_prepare_release() {
  local tarball="${WORK_DIR}/jetyet-src.tar.gz"
  local extract_dir="${UNPRIV_WORK_DIR}/src-extract"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"

  info "Downloading Jetyet source (${REPO}@${REF})..."
  if [[ -n "$GH_PROXY" ]]; then
    warn "Downloading Jetyet source archive through mirror (${GH_PROXY}); source archives are not cryptographically signed."
  fi
  download_file "https://github.com/${REPO}/archive/${REF}.tar.gz" "$tarball"

  local commit
  commit=$(extract_commit_from_tarball "$tarball")

  tar -xzf "$tarball" -C "$extract_dir"
  local src_dir
  src_dir=$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  [[ -n "$src_dir" && -f "${src_dir}/package.json" ]] || fail "Invalid Jetyet source archive."

  local bun_for_install="$STAGED_BUN_BIN"
  if ((EUID == 0)); then
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "$extract_dir"
    if [[ "$bun_for_install" != "$BUN_BIN" ]]; then
      install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$bun_for_install" "${UNPRIV_WORK_DIR}/bun-build"
      bun_for_install="${UNPRIV_WORK_DIR}/bun-build"
    fi
  fi

  info "Installing locked dependencies with Bun (unprivileged)..."
  local bun_cache="${UNPRIV_WORK_DIR}/bun-cache"
  mkdir -p "$bun_cache"
  ((EUID == 0)) && chown -R "${SERVICE_USER}:${SERVICE_USER}" "$bun_cache"
  (
    cd "$src_dir"
    run_unprivileged env BUN_INSTALL_CACHE_DIR="$bun_cache" "$bun_for_install" install --frozen-lockfile
  )

  STAGE_NEXT="/opt/.jetyet.next.$$"
  run_root rm -rf "$STAGE_NEXT"
  run_root install -d -o root -g root -m 0755 "$STAGE_NEXT"

  local item
  for item in src scripts node_modules package.json bun.lock; do
    [[ -e "${src_dir}/${item}" ]] || fail "Expected ${item} in Jetyet archive."
    run_root cp -a "${src_dir}/${item}" "${STAGE_NEXT}/"
  done
  run_root install -d -o root -g root -m 0755 "${STAGE_NEXT}/deploy"
  for item in Caddyfile nginx.conf; do
    if [[ -f "${src_dir}/deploy/${item}" ]]; then
      run_root install -o root -g root -m 0644 "${src_dir}/deploy/${item}" "${STAGE_NEXT}/deploy/${item}"
    fi
  done

  local meta_tmp="${WORK_DIR}/release.meta"
  cat >"$meta_tmp" <<EOF
REPO=${REPO}
REF=${REF}
COMMIT=${commit}
INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  run_root install -o root -g root -m 0644 "$meta_tmp" "${STAGE_NEXT}/.jetyet-release"

  run_root chown -R root:root "$STAGE_NEXT"
  run_root chmod -R a+rX,go-w "$STAGE_NEXT"

  PREPARED_SRC_DIR="$src_dir"
  PREPARED_COMMIT="$commit"
}

snapshot_live_state() {
  TX_PREV_UNITS_DIR="${WORK_DIR}/prev-units"
  TX_PREV_DEPS_DIR="${WORK_DIR}/prev-deps"
  TX_PREV_CLI_FILE="${WORK_DIR}/prev-cli"
  mkdir -p "$TX_PREV_UNITS_DIR" "$TX_PREV_DEPS_DIR"
  TX_PREV_UNIT_EXISTS=()
  TX_PREV_UNIT_ENABLED=()
  TX_PREV_UNIT_ACTIVE=()
  TX_DEP_EXISTED=()
  TX_PREV_CLI_EXISTED=0

  local service
  for service in "${SERVICES[@]}"; do
    if run_root test -f "/etc/systemd/system/${service}"; then
      TX_PREV_UNIT_EXISTS["$service"]=1
      run_root cp -a "/etc/systemd/system/${service}" "${TX_PREV_UNITS_DIR}/${service}"
      if systemctl is-enabled --quiet "$service" 2>/dev/null; then
        TX_PREV_UNIT_ENABLED["$service"]=1
      else
        TX_PREV_UNIT_ENABLED["$service"]=0
      fi
      if systemctl is-active --quiet "$service" 2>/dev/null; then
        TX_PREV_UNIT_ACTIVE["$service"]=1
      else
        TX_PREV_UNIT_ACTIVE["$service"]=0
      fi
    else
      TX_PREV_UNIT_EXISTS["$service"]=0
      TX_PREV_UNIT_ENABLED["$service"]=0
      TX_PREV_UNIT_ACTIVE["$service"]=0
    fi
  done

  local dep
  TX_DEP_PREV_SHA=()
  for dep in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    if [[ -n "${STAGED_DEP_BIN[$dep]:-}" ]]; then
      if run_root test -e "$dep"; then
        TX_DEP_EXISTED["$dep"]=1
        run_root cp -a "$dep" "${TX_PREV_DEPS_DIR}/$(basename "$dep")"
        if run_root test -f "$dep" && ! run_root test -L "$dep"; then
          TX_DEP_PREV_SHA["$dep"]=$(sha256_file "$dep")
        fi
      else
        TX_DEP_EXISTED["$dep"]=0
      fi
    fi
  done

  if run_root test -f "$CLI_PATH"; then
    TX_PREV_CLI_EXISTED=1
    run_root cp -a "$CLI_PATH" "$TX_PREV_CLI_FILE"
  fi
}

stop_services_strict() {
  local service
  for service in "${SERVICES[@]:1}" "${SERVICES[0]}"; do
    if run_root test -f "/etc/systemd/system/${service}"; then
      if systemctl is-active --quiet "$service" 2>/dev/null; then
        run_root systemctl stop "$service" || fail "Failed to stop ${service}."
        if systemctl is-active --quiet "$service" 2>/dev/null; then
          fail "${service} is still active after stop."
        fi
      fi
    fi
  done
}

install_systemd_units() {
  local src_dir="$1"
  local service
  for service in "${SERVICES[@]}"; do
    [[ -f "${src_dir}/deploy/${service}" ]] || fail "Missing systemd unit ${service} in source archive."
    run_root install -o root -g root -m 0644 "${src_dir}/deploy/${service}" "/etc/systemd/system/${service}"
  done
  run_root systemctl daemon-reload
}

wait_for_web() {
  local web_url="$1"
  local attempt
  for ((attempt = 0; attempt < 30; attempt++)); do
    if systemctl is-active --quiet jetyet-web.service 2>/dev/null &&
      curl --noproxy '*' --silent --fail --max-time 2 "$web_url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_all_services_active() {
  local attempt service all_ok
  for ((attempt = 0; attempt < 15; attempt++)); do
    all_ok=1
    for service in "${SERVICES[@]}"; do
      if ! systemctl is-active --quiet "$service" 2>/dev/null; then
        all_ok=0
        break
      fi
    done
    if ((all_ok == 1)); then
      sleep 2
      for service in "${SERVICES[@]}"; do
        if ! systemctl is-active --quiet "$service" 2>/dev/null; then
          return 1
        fi
      done
      return 0
    fi
    sleep 1
  done
  return 1
}

install_local_cli() {
  local src_dir="$1"
  if [[ -f "${src_dir}/deploy/jetyet.sh" ]]; then
    run_root install -o root -g root -m 0755 "${src_dir}/deploy/jetyet.sh" "$CLI_PATH"
  else
    warn "Selected ref (${REF}) does not contain deploy/jetyet.sh; keeping existing ${CLI_PATH} unchanged."
  fi
}

rollback_transaction() {
  TX_ROLLING_BACK=1
  trap '' INT TERM HUP
  local rollback_ok=1
  warn "Deployment failed mid-transaction; rolling back to previous state..."

  local service
  for service in "${SERVICES[@]:1}" "${SERVICES[0]}"; do
    if run_root test -f "/etc/systemd/system/${service}"; then
      run_root systemctl stop "$service" >/dev/null 2>&1 || rollback_ok=0
    fi
  done

  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    if run_root rm -rf "$INSTALL_DIR" && run_root mv "$BACKUP_DIR" "$INSTALL_DIR"; then
      BACKUP_DIR=""
    else
      rollback_ok=0
    fi
  elif ((TX_INSTALLED_NEW_DIR == 1)); then
    run_root rm -rf "$INSTALL_DIR" || rollback_ok=0
  fi

  local dep
  for dep in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    if [[ -n "${STAGED_DEP_BIN[$dep]:-}" ]]; then
      if ((${TX_DEP_EXISTED[$dep]:-0} == 1)); then
        run_root install -o root -g root -m 0755 "${TX_PREV_DEPS_DIR}/$(basename "$dep")" "$dep" || rollback_ok=0
      else
        run_root rm -f "$dep" || rollback_ok=0
      fi
    fi
  done

  for service in "${SERVICES[@]}"; do
    if ((${TX_PREV_UNIT_EXISTS[$service]:-0} == 1)); then
      run_root install -o root -g root -m 0644 "${TX_PREV_UNITS_DIR}/${service}" "/etc/systemd/system/${service}" || rollback_ok=0
    else
      run_root systemctl disable "$service" >/dev/null 2>&1 || true
      run_root rm -f "/etc/systemd/system/${service}" || rollback_ok=0
    fi
  done
  run_root systemctl daemon-reload || rollback_ok=0

  for service in "${SERVICES[@]}"; do
    if ((${TX_PREV_UNIT_EXISTS[$service]:-0} == 1)); then
      if ((${TX_PREV_UNIT_ENABLED[$service]:-0} == 1)); then
        run_root systemctl enable "$service" >/dev/null 2>&1 || rollback_ok=0
      else
        run_root systemctl disable "$service" >/dev/null 2>&1 || true
      fi
    fi
  done

  if ((TX_PREV_CLI_EXISTED == 1)); then
    run_root install -o root -g root -m 0755 "$TX_PREV_CLI_FILE" "$CLI_PATH" || rollback_ok=0
  elif [[ -n "${PREPARED_SRC_DIR:-}" ]]; then
    run_root rm -f "$CLI_PATH" || rollback_ok=0
  fi

  if ((${TX_PREV_UNIT_ACTIVE["jetyet-web.service"]:-0} == 1)); then
    if ! run_root systemctl start jetyet-web.service; then
      rollback_ok=0
    elif [[ -n "$TX_WEB_URL" ]] && ! wait_for_web "$TX_WEB_URL"; then
      rollback_ok=0
    fi
  fi

  for service in "${SERVICES[@]:1}"; do
    if ((${TX_PREV_UNIT_ACTIVE[$service]:-0} == 1)); then
      if ! run_root systemctl start "$service"; then
        rollback_ok=0
      fi
    fi
  done

  for service in "${SERVICES[@]}"; do
    if ((${TX_PREV_UNIT_ACTIVE[$service]:-0} == 1)); then
      if ! systemctl is-active --quiet "$service" 2>/dev/null; then
        warn "Rollback: ${service} failed to return to active state."
        rollback_ok=0
      fi
    fi
  done

  TX_ACTIVE=0
  if ((rollback_ok == 1)); then
    warn "Rollback succeeded; previous state restored."
  else
    PRESERVE_WORK_DIR=1
    warn "Rollback completed with errors; inspect /opt/jetyet and systemctl status jetyet-*."
    if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
      warn "Previous installation backup remains at ${BACKUP_DIR}."
    fi
  fi
}

update_manifest_for_committed_deps() {
  local dep prev_manifest_sha prev_file_sha
  for dep in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    if [[ -n "${STAGED_DEP_SHA[$dep]:-}" ]]; then
      if ((${TX_DEP_EXISTED[$dep]:-0} == 0)); then
        MANIFEST_DEP_SHA["$dep"]="${STAGED_DEP_SHA[$dep]}"
      elif [[ -n "${MANIFEST_DEP_SHA[$dep]:-}" ]]; then
        prev_manifest_sha="${MANIFEST_DEP_SHA[$dep]}"
        prev_file_sha="${TX_DEP_PREV_SHA[$dep]:-}"
        if [[ -n "$prev_file_sha" && "${prev_file_sha,,}" == "${prev_manifest_sha,,}" ]]; then
          MANIFEST_DEP_SHA["$dep"]="${STAGED_DEP_SHA[$dep]}"
        else
          unset 'MANIFEST_DEP_SHA[$dep]'
        fi
      fi
    fi
  done
  write_manifest_atomic
}

read_previous_release_target() {
  if [[ -f "${INSTALL_DIR}/.jetyet-release" ]]; then
    local key val prev_repo="" prev_ref=""
    while IFS='=' read -r key val; do
      case "$key" in
        REPO) prev_repo="$val" ;;
        REF) prev_ref="$val" ;;
      esac
    done <"${INSTALL_DIR}/.jetyet-release"
    if ((REPO_EXPLICIT == 0)) && [[ -n "$prev_repo" ]]; then
      REPO="$prev_repo"
    fi
    if ((REF_EXPLICIT == 0)) && [[ -n "$prev_ref" ]]; then
      REF="$prev_ref"
    fi
  fi
}

cmd_install() {
  ensure_privilege
  detect_platform
  require_base_tools
  acquire_lock

  [[ ! -L "$INSTALL_DIR" ]] || fail "${INSTALL_DIR} must be a real directory, not a symlink."

  local config_exists=0
  if run_root test -e "$CONFIG_FILE"; then
    config_exists=1
  elif ! has_tty; then
    fail "First-time setup requires a controlling terminal (/dev/tty), or create ${CONFIG_FILE} before running install."
  fi

  load_manifest
  ensure_service_account_and_dirs
  ensure_work_dir
  stage_dependencies "$WITH_DEPS"

  local web_url=""
  if ((config_exists == 1)); then
    info "Existing configuration detected at ${CONFIG_FILE}; validating..."
    local bun_check="$STAGED_BUN_BIN"
    if ((EUID == 0)) && [[ "$bun_check" != "$BUN_BIN" ]]; then
      install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$bun_check" "${UNPRIV_WORK_DIR}/bun-cfg"
      bun_check="${UNPRIV_WORK_DIR}/bun-cfg"
    fi
    web_url=$(read_web_url "$bun_check") || fail "Check ${CONFIG_FILE} before continuing."
  fi

  fetch_and_prepare_release
  snapshot_live_state
  TX_WEB_URL="$web_url"
  TX_ACTIVE=1

  stop_services_strict
  commit_staged_dependencies
  verify_runtime_binaries

  if run_root test -d "$INSTALL_DIR"; then
    BACKUP_DIR="/opt/.jetyet.prev.$$"
    run_root rm -rf "$BACKUP_DIR"
    run_root mv "$INSTALL_DIR" "$BACKUP_DIR"
  else
    TX_INSTALLED_NEW_DIR=1
  fi
  run_root mv "$STAGE_NEXT" "$INSTALL_DIR"
  STAGE_NEXT=""

  run_as_jetyet sh -c 'cd "$1" && test -r src/server/index.ts' sh "$INSTALL_DIR" ||
    fail "The ${SERVICE_USER} service account must be able to read ${INSTALL_DIR}."

  if [[ -z "$web_url" ]]; then
    info "Running interactive first-time setup..."
    (
      cd "$INSTALL_DIR"
      run_as_jetyet env NODE_ENV=production JETYET_CONFIG="$CONFIG_FILE" "$BUN_BIN" scripts/setup.ts </dev/tty
    )
    web_url=$(read_web_url "$BUN_BIN") || fail "Check ${CONFIG_FILE} before continuing."
    TX_WEB_URL="$web_url"
  fi

  install_systemd_units "$PREPARED_SRC_DIR"

  info "Starting jetyet-web.service..."
  if ! run_root systemctl start jetyet-web.service || ! wait_for_web "$web_url"; then
    run_root journalctl -u jetyet-web.service -n 30 --no-pager || true
    fail "Jetyet Web did not respond at ${web_url}."
  fi

  run_root systemctl enable --now "${SERVICES[@]}" || fail "Failed to enable/start Jetyet services."
  if ! wait_for_all_services_active; then
    local s
    for s in "${SERVICES[@]}"; do
      if ! systemctl is-active --quiet "$s" 2>/dev/null; then
        run_root journalctl -u "$s" -n 20 --no-pager || true
      fi
    done
    fail "One or more Jetyet services failed to remain active."
  fi

  install_local_cli "$PREPARED_SRC_DIR"
  TX_ACTIVE=0
  update_manifest_for_committed_deps

  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    run_root rm -rf "$BACKUP_DIR"
    BACKUP_DIR=""
  fi

  info "Jetyet deployed successfully (${REPO}@${REF} ${PREPARED_COMMIT:0:12})."
  systemctl --no-pager is-active "${SERVICES[@]}"
  cat <<EOF

Next steps:
  - Configure HTTPS reverse proxy (samples in ${INSTALL_DIR}/deploy/Caddyfile and ${INSTALL_DIR}/deploy/nginx.conf).
  - Disable access logging for /sub/, /deploy/, and /auth/hysteria/ in your proxy.
  - Manage Jetyet anytime with: jetyet status | jetyet upgrade | jetyet uninstall
EOF
}

cmd_upgrade() {
  ensure_privilege
  detect_platform
  require_base_tools
  acquire_lock

  [[ ! -L "$INSTALL_DIR" ]] || fail "${INSTALL_DIR} must be a real directory, not a symlink."
  run_root test -d "$INSTALL_DIR" || fail "Jetyet is not installed at ${INSTALL_DIR}. Run 'install' first."
  run_root test -e "$CONFIG_FILE" || fail "Configuration missing at ${CONFIG_FILE}. Run 'install' first."

  read_previous_release_target
  load_manifest
  ensure_service_account_and_dirs
  ensure_work_dir
  stage_dependencies "$WITH_DEPS"

  local bun_check="$STAGED_BUN_BIN"
  if ((EUID == 0)) && [[ "$bun_check" != "$BUN_BIN" ]]; then
    install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$bun_check" "${UNPRIV_WORK_DIR}/bun-cfg"
    bun_check="${UNPRIV_WORK_DIR}/bun-cfg"
  fi
  local web_url
  web_url=$(read_web_url "$bun_check") || fail "Check ${CONFIG_FILE} before continuing."

  fetch_and_prepare_release
  snapshot_live_state
  TX_WEB_URL="$web_url"
  TX_ACTIVE=1

  info "Stopping services for upgrade..."
  stop_services_strict
  commit_staged_dependencies
  verify_runtime_binaries

  BACKUP_DIR="/opt/.jetyet.prev.$$"
  run_root rm -rf "$BACKUP_DIR"
  run_root mv "$INSTALL_DIR" "$BACKUP_DIR"
  run_root mv "$STAGE_NEXT" "$INSTALL_DIR"
  STAGE_NEXT=""

  run_as_jetyet sh -c 'cd "$1" && test -r src/server/index.ts' sh "$INSTALL_DIR" ||
    fail "The ${SERVICE_USER} account could not read upgraded ${INSTALL_DIR}."

  install_systemd_units "$PREPARED_SRC_DIR"

  info "Starting upgraded jetyet-web.service..."
  if ! run_root systemctl start jetyet-web.service || ! wait_for_web "$web_url"; then
    run_root journalctl -u jetyet-web.service -n 30 --no-pager || true
    fail "Upgrade failed: Jetyet Web did not respond at ${web_url}."
  fi

  run_root systemctl enable --now "${SERVICES[@]}" || fail "Failed to enable/start upgraded Jetyet services."
  if ! wait_for_all_services_active; then
    local s
    for s in "${SERVICES[@]}"; do
      if ! systemctl is-active --quiet "$s" 2>/dev/null; then
        run_root journalctl -u "$s" -n 20 --no-pager || true
      fi
    done
    fail "Upgrade failed: one or more Jetyet services did not become active."
  fi

  install_local_cli "$PREPARED_SRC_DIR"
  TX_ACTIVE=0
  update_manifest_for_committed_deps

  run_root rm -rf "$BACKUP_DIR"
  BACKUP_DIR=""

  info "Jetyet upgraded successfully (${REPO}@${REF} ${PREPARED_COMMIT:0:12})."
  systemctl --no-pager is-active "${SERVICES[@]}"
}

cmd_uninstall() {
  ensure_privilege
  detect_platform
  require_uninstall_tools
  acquire_lock
  load_manifest

  local managed_list=()
  local dep
  for dep in "$BUN_BIN" "$HYSTERIA_BIN" "$MIHOMO_BIN" "$SINGBOX_BIN"; do
    [[ -n "${MANIFEST_DEP_SHA[$dep]:-}" ]] && managed_list+=("$dep")
  done

  if ((ASSUME_YES == 0)); then
    has_tty || fail "Interactive confirmation required; pass --yes to run uninstall non-interactively."
    {
      printf '\nPlanned uninstall actions:\n'
      printf '  - Stop, disable, and remove systemd units (%s)\n' "${SERVICES[*]}"
      printf '  - Remove %s and %s\n' "$INSTALL_DIR" "$CLI_PATH"
      if ((PURGE == 1)); then
        printf '  - PERMANENTLY DELETE %s (config + masterKey) and %s (SQLite database)\n' "$CONFIG_DIR" "$STATE_DIR"
        if ((MANIFEST_CREATED_USER == 1)); then
          printf '  - Delete system user %s (created by this installer)\n' "$SERVICE_USER"
        fi
      fi
      if ((REMOVE_DEPS == 1)) && ((${#managed_list[@]} > 0)); then
        printf '  - Remove unmodified script-managed binaries (%s)\n' "${managed_list[*]}"
      fi
    } >/dev/tty

    confirm_tty "Continue with uninstall?" || {
      info "Uninstall cancelled."
      return 0
    }
    if ((PURGE == 0)); then
      local purge_prompt="Also permanently delete ${CONFIG_DIR} (config + masterKey) and ${STATE_DIR} (SQLite DB)?"
      if ((MANIFEST_CREATED_USER == 1)); then
        purge_prompt="Also permanently delete ${CONFIG_DIR} (config + masterKey), ${STATE_DIR} (SQLite DB), and system user ${SERVICE_USER}?"
      fi
      if confirm_tty "$purge_prompt"; then
        PURGE=1
      fi
    fi
    if ((REMOVE_DEPS == 0)) && ((${#managed_list[@]} > 0)); then
      if confirm_tty "Also remove unmodified binaries installed by this script (${managed_list[*]})?"; then
        REMOVE_DEPS=1
      fi
    fi
  fi

  info "Stopping and removing systemd services..."
  stop_services_strict
  local service
  for service in "${SERVICES[@]:1}" "${SERVICES[0]}"; do
    if run_root test -f "/etc/systemd/system/${service}"; then
      run_root systemctl disable "$service" 2>/dev/null || true
      run_root rm -f "/etc/systemd/system/${service}"
    fi
  done
  run_root systemctl daemon-reload

  if run_root test -d "$INSTALL_DIR"; then
    info "Removing ${INSTALL_DIR}..."
    run_root rm -rf "$INSTALL_DIR"
  fi

  if ((REMOVE_DEPS == 1)); then
    if ((${#managed_list[@]} > 0)); then
      local expected_sha actual_sha
      for dep in "${managed_list[@]}"; do
        expected_sha="${MANIFEST_DEP_SHA[$dep]}"
        if run_root test -f "$dep" && ! run_root test -L "$dep"; then
          actual_sha=$(sha256_file "$dep")
          if [[ "${actual_sha,,}" == "${expected_sha,,}" ]]; then
            info "Removing managed dependency ${dep}..."
            run_root rm -f "$dep"
            unset 'MANIFEST_DEP_SHA[$dep]'
          else
            warn "Skipping ${dep}: file was modified since Jetyet installed it."
          fi
        else
          unset 'MANIFEST_DEP_SHA[$dep]'
        fi
      done
    else
      info "No script-managed dependency binaries recorded; leaving /usr/local/bin/* untouched."
    fi
  fi

  if ((PURGE == 1)); then
    info "Purging ${CONFIG_DIR} and ${STATE_DIR}..."
    run_root rm -rf "$CONFIG_DIR" "$STATE_DIR"
    if id "$SERVICE_USER" >/dev/null 2>&1; then
      if ((MANIFEST_CREATED_USER == 1)); then
        info "Removing system user ${SERVICE_USER}..."
        if run_root userdel "$SERVICE_USER" 2>/dev/null; then
          MANIFEST_CREATED_USER=0
        else
          warn "Could not remove user ${SERVICE_USER}."
        fi
      else
        warn "Preserving system user ${SERVICE_USER} (not recorded as created by this installer)."
      fi
    fi
  else
    info "Preserved ${CONFIG_DIR} and ${STATE_DIR}. Re-run with --purge to remove them."
  fi

  if ((${#MANIFEST_DEP_SHA[@]} == 0 && MANIFEST_CREATED_USER == 0)); then
    run_root rm -rf "$META_DIR"
  else
    ensure_work_dir
    write_manifest_atomic
  fi

  if run_root test -f "$CLI_PATH"; then
    run_root rm -f "$CLI_PATH"
  fi

  info "Jetyet uninstalled."
}

cmd_status() {
  printf 'Jetyet status:\n'
  if [[ -f "${INSTALL_DIR}/.jetyet-release" ]]; then
    printf '  Install dir : %s (installed)\n' "$INSTALL_DIR"
    sed 's/^/    /' "${INSTALL_DIR}/.jetyet-release"
  elif [[ -d "$INSTALL_DIR" ]]; then
    printf '  Install dir : %s (installed, no release metadata)\n' "$INSTALL_DIR"
  else
    printf '  Install dir : %s (not installed)\n' "$INSTALL_DIR"
  fi

  if [[ -e "$CONFIG_FILE" ]] || { ((EUID != 0)) && sudo -n test -e "$CONFIG_FILE" 2>/dev/null; }; then
    printf '  Config      : %s (present)\n' "$CONFIG_FILE"
  else
    printf '  Config      : %s (not checked or missing)\n' "$CONFIG_FILE"
  fi

  printf '  Services:\n'
  local service state
  if ! command -v systemctl >/dev/null 2>&1; then
    printf '    systemctl not available\n'
  else
    for service in "${SERVICES[@]}"; do
      if [[ ! -f "/etc/systemd/system/${service}" ]]; then
        state="not-installed"
      else
        state=$(systemctl is-active "$service" 2>&1 || true)
        [[ -n "$state" ]] || state="unknown"
      fi
      printf '    %-28s %s\n' "$service" "$state"
    done
  fi

  printf '  Dependencies:\n'
  local v
  v=$(installed_bun_version 2>/dev/null || true)
  printf '    %-12s %s\n' "bun" "${v:-missing}"
  v=$(installed_hysteria_version 2>/dev/null || true)
  printf '    %-12s %s\n' "hysteria" "${v:-missing}"
  v=$(installed_mihomo_version 2>/dev/null || true)
  printf '    %-12s %s\n' "mihomo" "${v:-missing}"
  v=$(installed_singbox_version 2>/dev/null || true)
  printf '    %-12s %s\n' "sing-box" "${v:-missing}"
}

run_interactive_menu() {
  has_tty || fail "No command specified and no controlling terminal (/dev/tty) is available. Pass install, upgrade, uninstall, or status."

  local state_label="not installed"
  if [[ -d "$INSTALL_DIR" ]]; then
    state_label="installed"
  fi

  cat >/dev/tty <<EOF

Jetyet Linux Manager (${state_label})
  1) Install / Deploy Jetyet
  2) Upgrade Jetyet
  3) Upgrade Jetyet + dependencies (Bun, Hysteria 2, mihomo, sing-box)
  4) Uninstall Jetyet
  5) Status
  0) Exit
EOF

  local choice=""
  prompt_tty "Select an option [0-5]: " choice
  case "$choice" in
    1) cmd_install ;;
    2) cmd_upgrade ;;
    3)
      WITH_DEPS=1
      cmd_upgrade
      ;;
    4) cmd_uninstall ;;
    5) cmd_status ;;
    0 | "") info "Exited." ;;
    *) fail "Invalid selection: ${choice}" ;;
  esac
}

main() {
  parse_args "$@"
  case "$ACTION" in
    install) cmd_install ;;
    upgrade) cmd_upgrade ;;
    uninstall) cmd_uninstall ;;
    status) cmd_status ;;
    help) usage ;;
    "") run_interactive_menu ;;
  esac
}

main "$@"
