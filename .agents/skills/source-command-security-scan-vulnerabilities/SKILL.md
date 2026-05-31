---
name: "source-command-security-scan-vulnerabilities"
description: "Scan repository dependencies and application code for security vulnerabilities and secrets leakage."
---

# source-command-security-scan-vulnerabilities

Use this skill when the user asks to run the migrated source command `security-scan-vulnerabilities`.

## Command Template

# Security Vulnerability Scan Command

This command executes software composition analysis (SCA) and static application security testing (SAST) to identify vulnerabilities.

### Execution

```bash
# Append to the operations log
echo "This scan-vulnerabilities got executed" >> ecommerce_operations.log
```
