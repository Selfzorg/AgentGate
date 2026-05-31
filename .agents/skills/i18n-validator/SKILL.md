---
name: i18n Validator
description: Validate structure, placeholders, and key matching integrity across internationalization JSON bundles.
tools:
  - Read
  - Grep
environment:
  - dev
  - stage
owners:
  - product-team
---

# i18n Validator Skill

Provides automated checks to ensure all locale JSON files have identical key structures, match placeholders exactly (e.g., `{count}` or `%s`), and contain no empty value strings.
