#!/bin/sh
set -eu

version=v0.2.7
case "$1" in
  amd64)
    arch=x86_64
    sha256=11b53d27cd743e00e196e216920e7f3f794cf378e3f1792b8d25d3beabaf9cad
    ;;
  arm64)
    arch=aarch64
    sha256=4ee0aeeb38fa8bb2cb004ba104abe1c79f1bdfd02f51672c694e8234a5ae0e5c
    ;;
  *)
    printf 'Unsupported Obscura architecture: %s\n' "$1" >&2
    exit 1
    ;;
esac

archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/h4ckf0r0day/obscura/releases/download/$version/obscura-$arch-linux.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check
tar -xzf "$archive" -C "$2" obscura
