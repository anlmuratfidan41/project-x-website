# Deploying projectx.build on AWS Lightsail

One small Ubuntu server runs everything: Caddy (HTTPS) in front of the Node app, which serves both the website and `/api`. The SQLite database lives on the server's disk and is backed up to S3 every night.

**Why Lightsail (or EC2):** the app stores data in a SQLite file, so it needs a persistent disk. Services that rebuild the disk on every deploy (App Runner, Elastic Beanstalk, Lambda) would lose data unless the database is first moved to RDS.

**Cost:** Lightsail Linux, 2 GB RAM plan (about $10/month, includes static IP and transfer) + S3 backups (cents per month). The 2 GB plan is recommended because the build step needs more memory than the 512 MB plan has.

## 1. Create the server

1. Lightsail → **Create instance** → Linux/Unix → **OS only: Ubuntu 24.04 LTS** → 2 GB plan → name it `projectx`.
2. **Networking** → create and attach a **static IP**.
3. **Networking → IPv4 firewall**: keep SSH (22) and add **HTTP (80)** and **HTTPS (443)**.
4. **Snapshots** → turn on **automatic snapshots** (daily disk snapshots on top of the S3 database backups).

## 2. Point the domain at the server

At the registrar for projectx.build (or in Route 53):

| Type | Name | Value |
|---|---|---|
| A | `@` (projectx.build) | the Lightsail static IP |
| A | `www` | the same static IP |

Wait until `ping projectx.build` shows the static IP before step 6 (Caddy needs it to get the certificate).

## 3. Install the software (SSH into the server)

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git sqlite3 build-essential python3 unzip curl debian-keyring debian-archive-keyring apt-transport-https
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
# AWS CLI (for backups)
curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip -q awscliv2.zip && sudo ./aws/install
# App user and folders
sudo useradd --system --create-home --shell /bin/bash projectx
sudo mkdir -p /opt/projectx /var/data && sudo chown projectx:projectx /opt/projectx /var/data
```

## 4. Get the code onto the server

Either clone from your Git host:

```bash
sudo -iu projectx git clone <your repository URL> /opt/projectx/app
```

or copy the `project-x-app` folder from your computer (without `node_modules`, `dist` and `backend/data`) to `/opt/projectx/app` with `scp`/`rsync`, then `sudo chown -R projectx:projectx /opt/projectx/app`.

## 5. Configure and build

```bash
sudo -iu projectx
cd /opt/projectx/app
cp backend/.env.production.example backend/.env
nano backend/.env          # fill in ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), RESEND_*, TWILIO_* ...
chmod 600 backend/.env
chmod +x backend/deploy/aws/*.sh
npm ci && npm test && npm run build
exit
```

## 6. Start the app and HTTPS

```bash
sudo cp /opt/projectx/app/backend/deploy/aws/projectx.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now projectx
curl http://127.0.0.1:4000/api/health          # → {"status":"ok",...}

sudo cp /opt/projectx/app/backend/deploy/aws/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open https://projectx.build — Caddy requests the certificate on the first visit. `https://www.projectx.build` redirects to `https://projectx.build`. Sign in at https://projectx.build/admin/login with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then remove `ADMIN_PASSWORD` from `backend/.env` (it is only used to create the first account).

Allow the app user to restart its own service (used by `update.sh`):

```bash
echo 'projectx ALL=(root) NOPASSWD: /usr/bin/systemctl restart projectx' | sudo tee /etc/sudoers.d/projectx
```

## 7. Nightly database backups to S3

1. S3 → create a private bucket, e.g. `projectx-backups` (block all public access). Add a **lifecycle rule** to delete objects under `db/` after 30 days.
2. IAM → create a user `projectx-backup` with a policy that only allows `s3:PutObject` on `arn:aws:s3:::projectx-backups/db/*`. Create an access key for it.
3. On the server: `sudo -iu projectx aws configure` (enter that key; region of the bucket).
4. Test: `sudo -iu projectx env BACKUP_BUCKET=projectx-backups /opt/projectx/app/backend/deploy/aws/backup-db.sh`
5. Schedule it: `sudo -iu projectx crontab -e` and add
   `15 3 * * * BACKUP_BUCKET=projectx-backups /opt/projectx/app/backend/deploy/aws/backup-db.sh >> /home/projectx/backup.log 2>&1`

**Restore:** download a backup, `gunzip` it, stop the app (`sudo systemctl stop projectx`), copy it to `/var/data/projectx.sqlite` (owner `projectx`), start the app.

## 8. After launch

- **Email:** in Resend, add the domain `projectx.build` and create the DNS records it shows (SPF/DKIM). Until it is verified, customers cannot receive confirmation links or quotes.
- **Uptime alerts:** UptimeRobot (or Better Stack) → HTTP monitor for `https://projectx.build/api/health`, every 5 minutes, alert by SMS/email.
- **Google:** Search Console → add `https://projectx.build` → submit `https://projectx.build/sitemap.xml`.
- **Updates:** `sudo -iu projectx /opt/projectx/app/backend/deploy/aws/update.sh` (pull, install, test, build, restart, health check).
- **Logs:** `sudo journalctl -u projectx -f` (app) and `sudo journalctl -u caddy -f` (HTTPS). Errors also appear on Admin → Health.
