#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/content-engine}"
APP_USER="${APP_USER:-admin}"
PUBLIC_HOST="${PUBLIC_HOST:-139.196.223.58}"
DB_NAME="${DB_NAME:-content_engine}"
DB_USER="${DB_USER:-content_engine}"
UPLOAD_ROOT="${UPLOAD_ROOT:-/var/lib/content-engine/uploads}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/package.json" || ! -d "${APP_DIR}/dist" ]]; then
  echo "Application build is missing in ${APP_DIR}." >&2
  exit 1
fi

install -d -m 0750 -o "${APP_USER}" -g "${APP_USER}" "${UPLOAD_ROOT}"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  db_password="$(openssl rand -hex 24)"
  jwt_secret="$(openssl rand -hex 48)"
  encryption_key="$(openssl rand -hex 48)"

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${db_password}'"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE ${DB_USER} PASSWORD '${db_password}'"
  fi

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
  fi

  umask 077
  cat > "${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=8787
HOST=127.0.0.1
DATABASE_URL=postgres://${DB_USER}:${db_password}@127.0.0.1:5432/${DB_NAME}
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=${jwt_secret}
CREDENTIAL_ENCRYPTION_KEY=${encryption_key}
CORS_ORIGIN=http://${PUBLIC_HOST}
UPLOAD_ROOT=${UPLOAD_ROOT}
WORKSPACE_DELETE_ENABLED=false
PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome-stable
EOF
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
fi

sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm run db:migrate"

cat > /etc/systemd/system/content-engine-api.service <<EOF
[Unit]
Description=Content Engine API
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/server/index.cjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/content-engine-worker.service <<EOF
[Unit]
Description=Content Engine Worker
After=network.target postgresql.service redis-server.service content-engine-api.service
Requires=postgresql.service redis-server.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/server/worker.cjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/nginx/sites-available/content-engine <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${PUBLIC_HOST} _;

    root ${APP_DIR}/dist;
    index index.html;
    client_max_body_size 50m;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8787/health;
        proxy_set_header Host \$host;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/gohome /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/content-engine /etc/nginx/sites-enabled/content-engine

systemctl daemon-reload
systemctl enable --now content-engine-api.service content-engine-worker.service
nginx -t
systemctl reload nginx

curl --fail --silent --show-error http://127.0.0.1:8787/health
echo
echo "Deployment completed: http://${PUBLIC_HOST}"
