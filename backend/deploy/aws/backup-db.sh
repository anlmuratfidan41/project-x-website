#!/usr/bin/env bash
# Nightly database backup to S3. Uses SQLite's online backup, so the site keeps running.
# Cron (as user projectx):  15 3 * * *  BACKUP_BUCKET=projectx-backups /opt/projectx/app/backend/deploy/aws/backup-db.sh
set -euo pipefail

DB="${DATABASE_PATH:-/var/data/projectx.sqlite}"
BUCKET="${BACKUP_BUCKET:?Set BACKUP_BUCKET to the S3 bucket name}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sqlite3 "$DB" ".backup '$WORK/projectx-$STAMP.sqlite'"
sqlite3 "$WORK/projectx-$STAMP.sqlite" 'PRAGMA integrity_check;' | grep -qx ok
gzip "$WORK/projectx-$STAMP.sqlite"
aws s3 cp "$WORK/projectx-$STAMP.sqlite.gz" "s3://$BUCKET/db/projectx-$STAMP.sqlite.gz" --only-show-errors
echo "Backed up $DB to s3://$BUCKET/db/projectx-$STAMP.sqlite.gz"
