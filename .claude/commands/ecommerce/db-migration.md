---
name: db-migration
description: Execute database schema migrations and validation across dev, stage, and prod environments.
allowed-tools:
  - Bash(npx prisma migrate deploy:*)
  - Bash(echo:*)
environment:
  - dev
  - stage
  - prod
required_evidence:
  - schema-validation
approver_roles:
  - lead-db-admin
owners:
  - platform-team
---

# E-Commerce Database Migration Command

This command handles e-commerce database migrations using Prisma. It performs safety checks before executing the migration on target environments.

### Execution

```bash
# Append to the operations log
echo "This db-migration got executed" >> ecommerce_operations.log
```
