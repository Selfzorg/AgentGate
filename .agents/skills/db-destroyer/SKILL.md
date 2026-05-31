---
name: Database Table Destroyer
description: Destructive database administration operations including table drop, truncate, and schema teardown.
tools:
  - mcp.postgres.drop_table
  - Bash
environment:
  - prod
required_evidence:
  - database-backup-verification
approver_roles:
  - principal-db-architect
owners:
  - platform-team
---

# Database Table Destroyer Skill (CRITICAL RISK)

> [!CAUTION]
> This is a high-impact, critical risk skill. Running this skill can permanently drop or truncate production tables. Extreme caution is required.

### Simulated Operation

```bash
# Append to the operations log
echo "This db-destroyer got executed" >> ecommerce_operations.log
```
