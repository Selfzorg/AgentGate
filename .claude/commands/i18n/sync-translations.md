---
name: sync-translations
description: Synchronize and validate application translation key bundles across locales.
allowed-tools:
  - Bash(echo:*)
environment:
  - dev
  - stage
required_evidence:
  - translation-dryrun-report
approver_roles:
  - localization-lead
owners:
  - product-team
---

# Localization Sync Translations Command

This command audits the translation bundle diffs to ensure no missing keys or broken interpolation brackets exist before pushing to the translation service provider.

### Execution

```bash
# Append to the operations log
echo "This sync-translations got executed" >> ecommerce_operations.log
```
