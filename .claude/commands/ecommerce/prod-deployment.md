---
name: prod-deployment
description: Execute production deployment of e-commerce checkout and catalog microservices.
allowed-tools:
  - Bash(vercel deploy:*)
  - Bash(echo:*)
environment:
  - prod
required_evidence:
  - automated-testing-report
  - security-scan
approver_roles:
  - release-manager
owners:
  - devops-team
---

# E-Commerce Production Deployment Command

This command executes the deployment of built and tested docker images or vercel bundles to the production environment under strict governance.

### Execution

```bash
# Append to the operations log
echo "This prod-deployment got executed" >> ecommerce_operations.log
```
