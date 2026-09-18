---
"@executor-js/host-selfhost": patch
"executor": patch
---

Key the self-host's sign-in rate limit on the real client IP. The server now stamps the connecting address on every auth request, so a directly exposed instance limits each client separately with no configuration and a client cannot spoof its address. Behind a reverse proxy, set `EXECUTOR_TRUSTED_PROXY_HEADER` (the header the proxy sets, e.g. `cf-connecting-ip` or `x-real-ip`) and `EXECUTOR_TRUSTED_PROXIES` (the IPs or CIDR ranges the proxy connects from) together; the header is honoured only on connections from those addresses. Half-configured or malformed values refuse to boot.
