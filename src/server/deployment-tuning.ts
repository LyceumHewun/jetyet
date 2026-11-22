export const adaptiveTuningScript = String.raw`
tuning_log() { printf 'Adaptive tuning: %s\n' "$1"; }

if resources=$(LC_ALL=C free -b) &&
   read -r ram swap < <(awk '/^Mem:/ { ram=$2 } /^Swap:/ { print ram, $2 }' <<< "$resources") &&
   [[ "$ram" =~ ^[1-9][0-9]*$ && "$swap" =~ ^[0-9]+$ ]]; then
  target=8388608
  if (( ram >= 2147483648 )); then target=16777216; fi
  if receive=$(sysctl -n net.core.rmem_max) && send=$(sysctl -n net.core.wmem_max); then
    if (( receive < target || send < target )); then
      if (( receive < target )); then receive=$target; fi
      if (( send < target )); then send=$target; fi
      if sysctl -q -w "net.core.rmem_max=$receive" "net.core.wmem_max=$send" &&
         printf 'net.core.rmem_max = %s\nnet.core.wmem_max = %s\n' "$receive" "$send" > /etc/sysctl.d/90-jetyet-udp.conf; then
        tuning_log "UDP buffer limits set to $receive receive / $send send bytes"
      else
        tuning_log 'UDP buffer limits could not be applied and persisted'
      fi
    else
      tuning_log "existing UDP buffer limits meet the target of $target bytes"
    fi
  else
    tuning_log 'UDP buffer limits are unavailable'
  fi

  swap_file=/var/lib/jetyet.swap
  swap_unit=$(systemd-escape --path --suffix=swap "$swap_file")
  unit_path="/etc/systemd/system/$swap_unit"
  if (( swap > 0 )) || findmnt --fstab --types swap --noheadings >/dev/null; then
    tuning_log 'existing swap preserved'
  elif (( ram >= 2147483648 )); then
    tuning_log 'swap skipped because RAM is at least 2 GiB'
  elif [[ -e "$swap_file" || -L "$swap_file" || -e "$unit_path" || -L "$unit_path" ]]; then
    tuning_log 'swap skipped because the managed path is already occupied'
  elif available=$(LC_ALL=C df -B1 --output=avail /var/lib | awk 'NR == 2 { print $1 }') &&
       [[ "$available" =~ ^[0-9]+$ ]] && (( available - ram >= 2147483648 )); then
    if swap_tmp=$(mktemp /var/lib/.jetyet-swap.XXXXXX); then
      if dd if=/dev/zero of="$swap_tmp" bs=1M iflag=count_bytes count="$ram" status=none &&
         mkswap "$swap_tmp" >/dev/null && mv -T "$swap_tmp" "$swap_file" &&
         printf '[Swap]\nWhat=%s\n[Install]\nWantedBy=swap.target\n' "$swap_file" > "$unit_path" &&
         systemctl daemon-reload && systemctl start "$swap_unit"; then
        if systemctl enable "$swap_unit"; then
          tuning_log "created and enabled $ram bytes of swap"
        else
          tuning_log 'swap is active but could not be enabled at boot'
        fi
      else
        rm -f "$swap_tmp" "$swap_file" "$unit_path"
        systemctl daemon-reload || true
        tuning_log 'swap skipped because the host could not activate a swap file'
      fi
    else
      tuning_log 'swap skipped because the host could not allocate a temporary file'
    fi
  else
    tuning_log 'swap skipped because less than 2 GiB would remain on disk'
  fi
else
  tuning_log 'skipped because RAM and swap could not be read'
fi
`;
