---
name: "source-command-ecommerce-prod-deployment"
description: "Execute production deployment of e-commerce checkout and catalog microservices."
---

# source-command-ecommerce-prod-deployment

Use this skill when the user asks to run the migrated source command `ecommerce-prod-deployment`.

## Command Template

# E-Commerce Production Deployment Command

This command executes the deployment of built and tested docker images or vercel bundles to the production environment under strict governance.

### Execution

```bash
# Append to the operations log
echo "This prod-deployment got executed" >> ecommerce_operations.log
```
