#!/usr/bin/env bash
# Sets up a fresh Ubuntu box as a Majlis signal + relay server.
# usage: sudo bash setup.sh <public-ip> <relay-name> <relay-label>
set -euo pipefail
IP="$1"; NAME="${2:-ruh}"; LABEL="${3:-Riyadh}"
DOMAIN="$(echo "$IP" | tr . -).sslip.io"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nodejs npm caddy iptables-persistent

# Oracle's Ubuntu images only allow SSH in iptables; open what Majlis needs.
for rule in "-p udp --dport 7700" "-p udp --dport 7701" "-p tcp --dport 80" "-p tcp --dport 443"; do
  iptables -C INPUT $rule -j ACCEPT 2>/dev/null || iptables -I INPUT 5 $rule -j ACCEPT
done
ip6tables -C INPUT -p udp --dport 7700 -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p udp --dport 7700 -j ACCEPT || true
ip6tables -C INPUT -p udp --dport 7701 -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p udp --dport 7701 -j ACCEPT || true
netfilter-persistent save

# bigger UDP buffers for relaying video
cat > /etc/sysctl.d/90-majlis.conf <<SYS
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.core.rmem_default=4194304
net.core.wmem_default=4194304
SYS
sysctl --system -q

id majlis >/dev/null 2>&1 || useradd --system --home /opt/majlis --shell /usr/sbin/nologin majlis
mkdir -p /opt/majlis/data
cp /tmp/majlis/index.js /tmp/majlis/ident.js /tmp/majlis/invite.html /tmp/majlis/package.json /opt/majlis/
cd /opt/majlis && npm install --omit=dev --silent
chown -R majlis:majlis /opt/majlis

SECRET_FILE=/opt/majlis/data/secret
[ -s "$SECRET_FILE" ] || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"
chmod 600 "$SECRET_FILE"; chown majlis:majlis "$SECRET_FILE"

cat > /etc/systemd/system/majlis.service <<UNIT
[Unit]
Description=Majlis signal and relay server
After=network-online.target
Wants=network-online.target

[Service]
User=majlis
WorkingDirectory=/opt/majlis
Environment=DATA_DIR=/opt/majlis/data
Environment=PUBLIC_URL=https://$DOMAIN
Environment=RELAY_HOST=$DOMAIN
Environment=RELAY_NAME=$NAME
Environment=RELAY_LABEL=$LABEL
Environment=RELAYS=[{"name":"$NAME","label":"$LABEL","host":"$DOMAIN","udp":7701,"ws":"wss://$DOMAIN/relay"}]
Environment=HTTP_PORT=7780
ExecStart=/bin/sh -c 'RELAY_SECRET=\$(cat /opt/majlis/data/secret) exec /usr/bin/node index.js'
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  reverse_proxy 127.0.0.1:7780
}
CADDY

systemctl daemon-reload
systemctl enable --now majlis
systemctl restart caddy
sleep 2
systemctl --no-pager --lines=3 status majlis | head -5
echo "DOMAIN=$DOMAIN"
