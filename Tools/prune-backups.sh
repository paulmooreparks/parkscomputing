#!/bin/sh
# Deletes database backups older than 30 days, as the privacy policy
# promises (Legal/privacy.md, "How long data is kept"). The
# backups are the COPY_ONLY ones taken before each production deploy, in
# the SQL Server container's backup directory. Run it with every deploy.
MSYS_NO_PATHCONV=1 docker exec sqlserver-local find /var/opt/mssql/backup -maxdepth 1 -name 'ParksComputingAuth-*.bak' -mtime +30 -print -delete
