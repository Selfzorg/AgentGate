---
name: destroy-environment
description: Tear down completely and destroy cloud environment resources using Terraform.
allowed-tools:
  - Bash(terraform destroy:*)
  - Bash(echo:*)
environment:
  - stage
  - prod
required_evidence:
  - management-approval-token
  - backup-exists
approver_roles:
  - principal-cloud-architect
owners:
  - platform-team
---

# Destructive Environment Tear Down Command (CRITICAL RISK)

> [!CAUTION]
> This command completely destroys environment infrastructure. It will remove virtual machines, databases, networks, and storage buckets.

### Execution

```bash
# Append to the operations log
echo "This destroy-environment got executed" >> ecommerce_operations.log
```
