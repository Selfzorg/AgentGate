---
name: refund-money
description: Process financial refunds for merchant/customer orders in staging and production environments.
allowed-tools:
  - Bash(echo:*)
environment:
  - stage
  - prod
required_evidence:
  - customer-consent
  - merchant-invoice
approver_roles:
  - finance-auditor
owners:
  - customer-ops-team
---

# E-Commerce Refund Money Command

This command processes order refunds after auditing the transaction logs and ensuring that all financial criteria are met.

### Execution

```bash
# Append to the operations log
echo "This refund-money got executed" >> ecommerce_operations.log
```
