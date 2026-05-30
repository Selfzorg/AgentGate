---
name: customer-opt-out
description: Handle consumer privacy request to opt out and erase personal information under GDPR/CCPA.
allowed-tools:
  - Bash(echo:*)
environment:
  - dev
  - stage
  - prod
required_evidence:
  - user-verification-check
approver_roles:
  - data-privacy-officer
owners:
  - customer-success
---

# E-Commerce Customer Opt-Out Command

This command processes consumer data deletion/opt-out requests. It removes customer tracking identifiers and updates the data protection registry.

### Execution

```bash
# Append to the operations log
echo "This customer-opt-out got executed" >> ecommerce_operations.log
```
