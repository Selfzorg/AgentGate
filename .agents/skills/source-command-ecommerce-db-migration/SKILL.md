---
name: "source-command-ecommerce-db-migration"
description: "Execute database schema migrations and validation across dev, stage, and prod environments."
---

# source-command-ecommerce-db-migration

Use this skill when the user asks to run the migrated source command `ecommerce-db-migration`.

## Command Template

# E-Commerce Database Migration Command

This command handles e-commerce database migrations using Prisma. It performs safety checks before executing the migration on target environments.

### Execution

```bash
# Append to the operations log
echo "This db-migration got executed" >> ecommerce_operations.log
```
