#!/usr/bin/env bash
# Measure which USDA AMS hosts this runner can reach: DNS with the runner's own
# resolver and with public resolvers, then an HTTPS GET of one known report
# (AMS_2162, a weekly feeder cattle auction PDF). Prints one block per host.
# Read-only; never fails the job (the numbers are the point).
set -u
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PATH_REPORT="${AMS_CHECK_PATH:-/mnreports/AMS_2162.pdf}"
HOSTS="${AMS_CHECK_HOSTS:-www.ams.usda.gov ams.prod.usda.gov ams-prod.azureedge.us mymarketnews.ams.usda.gov marsapi.ams.usda.gov usda.azureedge.us}"
echo "resolver: $(grep -m3 '^nameserver' /etc/resolv.conf 2>/dev/null | tr '\n' ' ')"
command -v resolvectl >/dev/null && resolvectl dns 2>/dev/null | head -3
for h in $HOSTS; do
  echo "== $h"
  echo "getent: $(getent hosts "$h" 2>&1 | head -2 | tr '\n' ' ' || true)"
  ip=""
  if command -v dig >/dev/null; then
    for r in "" 1.1.1.1 8.8.8.8; do
      if [ -z "$r" ]; then a=$(dig +short +time=3 +tries=1 "$h" A 2>&1 | tr '\n' ' '); lab=runner
      else a=$(dig +short +time=3 +tries=1 @"$r" "$h" A 2>&1 | tr '\n' ' '); lab=$r; fi
      echo "dig $lab: ${a:-<empty>}"
      if [ -z "$ip" ] && [ -n "$r" ]; then
        ip=$(echo "$a" | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
      fi
    done
  fi
  out=$(mktemp)
  res=$(curl -sS -L --max-time 30 -A "$UA" -o "$out" \
        -w '%{http_code} %{size_download} %{url_effective}' "https://$h$PATH_REPORT" 2>&1 | tail -1)
  echo "get: $res magic=$(head -c 4 "$out" 2>/dev/null | tr -dc '[:print:]')"
  if [ -n "$ip" ] && ! getent hosts "$h" >/dev/null 2>&1; then
    res=$(curl -sS -L --max-time 30 --resolve "$h:443:$ip" -A "$UA" -o "$out" \
          -w '%{http_code} %{size_download}' "https://$h$PATH_REPORT" 2>&1 | tail -1)
    echo "get via public-dns ip $ip: $res magic=$(head -c 4 "$out" 2>/dev/null | tr -dc '[:print:]')"
  fi
  rm -f "$out"
done
exit 0
