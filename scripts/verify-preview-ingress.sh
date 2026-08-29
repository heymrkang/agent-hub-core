#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <preview-hostname>" >&2
  exit 64
fi

hostname=$1
case "$hostname" in
  *[!a-z0-9.-]*|.*|*..*|*.)
    echo "invalid preview hostname" >&2
    exit 64
    ;;
esac

url="https://$hostname/"
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT HUP INT TERM

status=$(curl --silent --show-error --location --max-time 20 \
  --dump-header "$headers" --output "$body" --write-out '%{http_code}' "$url")

echo "url=$url"
echo "status=$status"
if grep -qi '^server: cloudflare' "$headers"; then
  echo "cloudflare=yes"
else
  echo "cloudflare=no"
fi

case "$status" in
  2??|3??)
    echo "preview_ingress=ok"
    ;;
  *)
    echo "preview_ingress=failed" >&2
    sed -n '1,20p' "$body" >&2
    exit 1
    ;;
esac
