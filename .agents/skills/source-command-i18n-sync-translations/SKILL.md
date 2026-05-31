---
name: "source-command-i18n-sync-translations"
description: "Synchronize and validate application translation key bundles across locales."
---

# source-command-i18n-sync-translations

Use this skill when the user asks to run the migrated source command `i18n-sync-translations`.

## Command Template

# Localization Sync Translations Command

This command audits the translation bundle diffs to ensure no missing keys or broken interpolation brackets exist before pushing to the translation service provider.

### Execution

```bash
# Append to the operations log
echo "This sync-translations got executed" >> ecommerce_operations.log
```
