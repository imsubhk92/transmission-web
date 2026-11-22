#!/usr/bin/with-contenv bash
set -euo pipefail

# Run after LinuxServer's own configuration, before starting the daemon.
# Keep incomplete data beside the final file so FastAPI sees the exact same path.
download_path="${STREAMLINE_DOWNLOAD_DIR:-/downloads}"
mkdir -p "$download_path"
chown abc:abc "$download_path"
if [[ ! -f /config/settings.json ]]; then
    cp /defaults/settings.json /config/settings.json
fi
jq --arg directory "$download_path" \
    '.["download-dir"] = $directory | .["incomplete-dir-enabled"] = false' \
    /config/settings.json > /config/settings.streamline.json
mv /config/settings.streamline.json /config/settings.json
chown abc:abc /config/settings.json
