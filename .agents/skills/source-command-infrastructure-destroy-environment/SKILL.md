---
name: "source-command-infrastructure-destroy-environment"
description: "Tear down completely and destroy cloud environment resources using Terraform."
---

# source-command-infrastructure-destroy-environment

Use this skill when the user asks to run the migrated source command `infrastructure-destroy-environment`.

## Command Template

# Destructive Environment Tear Down Command (CRITICAL RISK)

> [!CAUTION]
> This command completely destroys environment infrastructure. It will remove virtual machines, databases, networks, and storage buckets.

### Execution

```bash
# Append to the operations log
echo "This destroy-environment got executed" >> ecommerce_operations.log
```
