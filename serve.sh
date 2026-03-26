#!/bin/sh
set -eu

# Start Tor in the background; note that this may take awhile even after the app starts
tor &

start_wireproxy() {
  if [ -z "${WIREPROXY_WG_CONFIG_BASE64:-}" ]; then
    echo "Wireproxy disabled: WIREPROXY_WG_CONFIG_BASE64 is not set."
    return 0
  fi

  wireproxy_dir="/tmp/wireproxy"
  wg_config_path="$wireproxy_dir/wireguard.conf"
  wireproxy_config_path="$wireproxy_dir/wireproxy.conf"
  socks_address="${WIREPROXY_SOCKS_ADDRESS:-127.0.0.1:1080}"

  mkdir -p "$wireproxy_dir"

  if ! printf '%s' "$WIREPROXY_WG_CONFIG_BASE64" | base64 -d > "$wg_config_path"; then
    echo "Wireproxy startup failed: invalid WIREPROXY_WG_CONFIG_BASE64 value." >&2
    exit 1
  fi

  cat > "$wireproxy_config_path" <<EOF
WGConfig = $wg_config_path

[Socks5]
BindAddress = $socks_address
EOF

  wireproxy -n -c "$wireproxy_config_path"
  wireproxy -c "$wireproxy_config_path" &
  echo "Wireproxy started at socks5h://$socks_address"
}

start_wireproxy

exec node backend.js
