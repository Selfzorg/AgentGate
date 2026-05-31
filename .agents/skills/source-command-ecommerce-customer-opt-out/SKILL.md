---
name: "source-command-ecommerce-customer-opt-out"
description: "Handle consumer privacy request to opt out and erase personal information under GDPR/CCPA."
---

# source-command-ecommerce-customer-opt-out

Use this skill when the user asks to run the migrated source command `ecommerce-customer-opt-out`.

## Command Template

# E-Commerce Customer Opt-Out Command

This command processes consumer data deletion/opt-out requests. It removes customer tracking identifiers and updates the data protection registry.

### Execution

```bash
# Append to the operations log
echo "This customer-opt-out got executed" >> ecommerce_operations.log
```
