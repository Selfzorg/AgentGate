---
name: SAST Auditor
description: Verify static application security testing (SAST) scan reports and identify false positives.
tools:
  - Read
  - Grep
environment:
  - dev
  - stage
  - prod
owners:
  - security-team
---

# SAST Auditor Skill

Provides automated capabilities to parse static scan logs (e.g. from Semgrep or SonarQube), classify vulnerabilities, track remediation steps, and verify security gate adherence before deployment.
