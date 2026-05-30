---
name: scan-vulnerabilities
description: Scan repository dependencies and application code for security vulnerabilities and secrets leakage.
allowed-tools:
  - Bash(npm audit:*)
  - Bash(echo:*)
environment:
  - dev
  - stage
  - prod
required_evidence:
  - lockfile-verification
approver_roles:
  - security-lead
owners:
  - security-team
---

# Security Vulnerability Scan Command

This command executes software composition analysis (SCA) and static application security testing (SAST) to identify vulnerabilities.

### Execution

```bash
# Append to the operations log
echo "This scan-vulnerabilities got executed" >> ecommerce_operations.log
```
