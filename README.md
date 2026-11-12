# Fleet Panel

A self-hosted web console for your VPS fleet — your own hosting control panel.
One website shows every server you link, its live metrics, all its pm2 apps,
and lets you restart / stop / start / tail logs / redeploy / deploy new apps
from git — no more SSH for routine ops.

Built to grow: the architecture (isolated API, per-server runners, encrypted
credential store) is designed to expand into a multi-tenant hosting platform
with subscriptions. See **Roadmap** below.

## What it does

- **Overview** — all linked servers with live CPU / RAM / disk gauges and app counts
- **Servers** — link any VPS over SSH (password or private key, stored
  AES-256-GCM encrypted); nothing is installed on the linked machine
- **Server detail** — live metrics + pm2 process table with logs
  (auto-refreshing tail), restart / stop / start / delete, and one-click
  **redeploy** (git pull → npm install → pm2 restart, streaming output)
- **Env editor** — per-app `.env` / `.env.local` / `.env.production` editing in
  the browser; every save keeps a timestamped `.bak-*` backup, with an optional
  **save & restart** so the change takes effect immediately
- **Nginx editor** — browse `/etc/nginx/sites-available`, see which configs are
  enabled and their `server_name`s, edit in place; saving runs `nginx -t`
  first and **rolls back automatically** if the test fails, plus a one-click
  nginx reload
- **Settings** — change the admin password from the UI (survives restarts;
  no need to touch `PANEL_PASSWORD` again)
- **Deploy** — push a new app to any linked server from a GitHub repo with
  env vars, port and start command; streams the whole deploy log live

## Requirements on the VPS

- Node.js 18+ and npm
- pm2 (`npm i -g pm2`) — on every server you want to manage
- git
- nginx (for the domain, recommended)

## Install on your VPS

```bash
# 1. get the code onto the VPS (upload the zip and unzip, or clone your fork)
cd ~
unzip fleet-panel.zip -d fleet-panel && cd fleet-panel

# 2. install and build
npm install
npm run build

# 3. set the admin password (required, min 8 chars) and start under pm2
PANEL_PASSWORD='pick-a-long-random-password' pm2 start server/index.js --name fleet-panel
pm2 save
```

The panel listens on port **5101** by default (override with `PORT=xxxx`).

> The password is read when the process starts. After first login you can
> change it anytime in **Settings** — the new password is stored as a durable
> scrypt hash in `data/auth.json` and survives restarts. You can also rotate
> it from the shell:
> `PANEL_PASSWORD='new-password' pm2 restart fleet-panel --update-env`
> (the env value is only the bootstrap — a hash saved from Settings wins).

## Put it behind your domain (vps.taskpesa.site)

Your DNS A record (`vps.taskpesa.site → 169.58.58.133`, Cloudflare
**DNS only**) already points at the VPS. Create
`/etc/nginx/sites-available/vps.taskpesa.site`:

```nginx
server {
    listen 80;
    server_name vps.taskpesa.site;

    location / {
        proxy_pass http://127.0.0.1:5101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # needed for the live deploy/log streams (SSE)
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Then:

```bash
sudo ln -s /etc/nginx/sites-available/vps.taskpesa.site /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# HTTPS — required, you type a password into this panel:
sudo certbot --nginx -d vps.taskpesa.site
```

> Cloudflare note: with the cloud set to **DNS only** (as it is now), traffic
> goes straight to your VPS and certbot works normally. If you later enable
> the orange-cloud proxy, the panel still works — SSE streams pass through —
> but add `proxy_set_header X-Forwarded-For $http_cf_connecting_ip;` so rate
> limiting sees real visitor IPs.

## Security model

- **Single strong admin password** (`PANEL_PASSWORD` bootstrap; after a
  Settings change, a durable **scrypt hash** in `data/auth.json` takes
  precedence), compared in constant time; sessions are random 256-bit tokens
  in an HttpOnly cookie (12 h, rolling), and all other sessions are revoked
  on password change
- **Login rate limiting**: 5 attempts per IP per 5 minutes
- **SSH secrets encrypted at rest** with AES-256-GCM; the key never leaves
  `data/.secret-key` (chmod 600) or your `PANEL_SECRET`
- **Command safety**: app names and inputs are validated against strict
  allow-lists before ever touching a shell; actions are a fixed set
- **Security headers**: nosniff, frame-deny, no-referrer
- **Firewall**: keep port 5101 closed to the public — only nginx (80/443)
  should be exposed: `sudo ufw deny 5101 && sudo ufw reload`

## Linking another VPS

1. Open the panel → **Servers** → **+ link a vps**
2. Enter host/IP, SSH port, user, and password **or** private key
3. The panel connects once to verify, then saves it

The linked VPS only needs SSH plus node/pm2. The panel finds pm2 even when
it's installed via nvm, volta, fnm or a user-local npm prefix.

> Security tip: use a non-root sudo user on linked machines, and restrict
> port 22 to your own IPs in the firewall where possible.

## Editing nginx configs from the panel

The nginx editor writes to `/etc/nginx/sites-available/`, runs `nginx -t`, and
reloads nginx. The panel process (your login user) needs permission for that.
One-time setup on each managed VPS:

```bash
# let your user edit the config files directly
sudo chown -R $USER /etc/nginx/sites-available

# allow passwordless nginx test + reload only
echo "$USER ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t, /usr/sbin/nginx -s reload, /bin/systemctl reload nginx" \
  | sudo tee /etc/sudoers.d/fleet-panel
```

Without this, saving a config shows the exact commands to run and changes
nothing. If your nginx lives somewhere other than `/etc/nginx`, set
`NGINX_ROOT=/path/to/nginx` when starting the panel.

## Where data lives

```
data/servers.json   # linked servers (secrets AES-256-GCM encrypted)
data/.secret-key    # encryption key (auto-generated, chmod 600)
data/auth.json      # admin password hash (created when you change it in Settings)
```

Created on first run next to the project. Back them up if you rebuild the
server; delete them to reset the panel.

## Roadmap — from personal panel to hosting platform

The codebase is structured so each step lands without rewrites:

1. **Multi-user accounts** — swap the single-password check in
   `server/lib/auth.js` for a users table (email + password hash, sessions
   already cookie-based). Servers in `data/servers.json` gain an `ownerId`.
2. **Plans & subscriptions** — add a `plans` table (servers/apps limits) and a
   billing webhook (Stripe, or MegaPay STK for local payments). Enforcement
   lives in one middleware on the server/deploy routes.
3. **Customer site hosting** — a "Sites" feature: each customer app gets its
   own pm2 process (already per-app isolated), an auto-generated nginx vhost
   from a template, and wildcard SSL (`*.taskpesa.site` via certbot DNS
   plugin). The deploy pipeline (`server/lib/probes.js`) already streams
   builds and is reusable per site.
4. **Team/agent nodes** — remote VPSs can later run a tiny agent instead of
   SSH for lower latency; the runner interface (`server/lib/runners.js`) is
   the single seam to extend.

## Environment variables

| Variable          | Required | Default | Purpose                                |
|-------------------|----------|---------|----------------------------------------|
| `PANEL_PASSWORD`  | yes      | —       | admin login password (min 8 chars)     |
| `PORT`            | no       | `5101`  | port the panel listens on              |
| `PANEL_SECRET`    | no       | auto    | passphrase deriving the encryption key |
| `PANEL_DATA_DIR`  | no       | `./data`| where servers.json + key are stored    |
| `LOCAL_SERVER_NAME` | no     | `This VPS (local)` | display name of the host server |
| `NGINX_ROOT`      | no       | `/etc/nginx` | nginx root for the config editor   |

## Development

```bash
npm run dev        # vite dev server (frontend)
PANEL_PASSWORD=dev-password PORT=5101 node server/index.js   # backend
```

The frontend falls back to demo data when no backend is reachable (e.g. a
static preview or opening `dist/index.html` without the server) and shows a
DEMO badge in the header.
