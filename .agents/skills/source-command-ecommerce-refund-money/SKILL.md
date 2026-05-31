---
name: "source-command-ecommerce-refund-money"
description: "Process financial refunds for merchant/customer orders in staging and production environments."
---

# source-command-ecommerce-refund-money

Use this skill when the user asks to run the migrated source command `ecommerce-refund-money`.

## Command Template

# E-Commerce Refund Money Command

This command processes order refunds after auditing the transaction logs and ensuring that all financial criteria are met.

### Execution

```bash
# Append to the operations log
echo "This refund-money got executed" >> ecommerce_operations.log
```
