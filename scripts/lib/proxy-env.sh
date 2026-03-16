#!/usr/bin/env bash

if [[ "${CLASH_PROXY_ENABLED:-true}" == "true" ]]; then
  export HTTP_PROXY="${HTTP_PROXY:-${CLASH_PROXY_URL:-http://127.0.0.1:7897}}"
  export HTTPS_PROXY="${HTTPS_PROXY:-${CLASH_PROXY_URL:-http://127.0.0.1:7897}}"
  export ALL_PROXY="${ALL_PROXY:-${CLASH_SOCKS_PROXY_URL:-${CLASH_PROXY_URL:-http://127.0.0.1:7897}}}"
  export http_proxy="$HTTP_PROXY"
  export https_proxy="$HTTPS_PROXY"
  export all_proxy="$ALL_PROXY"
  export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"
  export no_proxy="$NO_PROXY"
fi
