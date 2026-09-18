---
"@executor-js/host-selfhost": patch
"executor": patch
---

Add `EXECUTOR_DISABLE_AUTH_RATE_LIMIT` to the self-host. Better Auth 1.6.17 and later enforce sign-in rate limits strictly in production, and with no trusted proxy header every caller shares one bucket of three sign-ins per ten seconds. The Docker release gate signs in from many test files at once and tripped it. The flag is off by default; the e2e harness sets it for the image it tests.
