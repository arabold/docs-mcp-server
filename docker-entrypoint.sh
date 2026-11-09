#!/bin/sh

set -eu

# Runtime identities can change between OpenShift pod replacements. SQLite
# creates database files with mode 0644, so a database written by the previous
# identity must be replaced atomically with an equivalent writable copy before
# the new identity opens it. Only the dedicated runtime volumes are normalized.
for root in /data /config; do
  if [ ! -d "$root" ] || [ ! -w "$root" ]; then
    echo "❌ Runtime path $root is not writable by uid=$(id -u) gid=$(id -g)" >&2
    exit 1
  fi

  find "$root" -type f ! -perm -0002 -exec sh -eu -c '
    for path do
      replacement="${path}.permissions.$$"
      cp "$path" "$replacement"
      chmod a+rw "$replacement"
      mv -f "$replacement" "$path"
    done
  ' sh {} +
done

umask 0000
touch /data/documents.db
chmod a+rw /data/documents.db 2>/dev/null || test -w /data/documents.db

exec node --enable-source-maps /app/dist/index.js "$@"
