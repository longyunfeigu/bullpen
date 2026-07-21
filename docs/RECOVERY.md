# Recovery guide

## Before a manual update

1. Finish, stop, or record the state of running Sessions.
2. Quit Charter and confirm its terminal/Agent processes have exited.
3. Copy Charter's application-data directory to a safe location.
4. Verify the new artifact with the Release's `SHA256SUMS.txt`.
5. Replace the application and start it with the existing application-data directory.

Charter creates a timestamped database backup automatically before applying a pending schema
migration. A successful upgrade keeps the backup under the local `backups` directory.

## If the application shows the startup diagnostics page

- Do not delete the application-data directory.
- Quit Charter before copying or replacing `app.db`.
- Preserve `app.db`, `app.db-wal`, `app.db-shm`, the `backups` directory and logs.
- If the page reports a failed migration, the product has already attempted to restore the
  pre-migration database. Keep the displayed error code with any report.
- Reinstalling the executable alone does not erase Sessions; they live in application data.

## Restore the previous database and application

1. Quit Charter completely.
2. Make a second copy of the current application-data directory for diagnosis.
3. Reinstall the exact application version that created the chosen backup.
4. Replace `app.db` with the matching timestamped `.bak` file.
5. Remove stale `app.db-wal` and `app.db-shm` only while Charter is stopped.
6. Start Charter and verify the expected Sessions before deleting either backup.

Do not open the same database concurrently from two Charter versions.

## Interrupted Agent work

After an abnormal exit, Charter marks orphaned managed runs as interrupted and does not replay pending
tools. Open the Session to inspect the recorded events and files, then resume or perform a byte-exact
rollback. External CLI sessions may instead need to be resumed through that CLI's own session ID.

## Remove Charter

Deleting the application removes the executable but intentionally leaves local product data. To
remove everything, first back up anything you need, quit Charter, uninstall/delete the application,
then delete its operating-system application-data directory. Repository files and Git worktrees must
be reviewed separately; never recursively delete a workspace just to uninstall Charter.
