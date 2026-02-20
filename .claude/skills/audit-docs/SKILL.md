---
name: audit-docs
description: Audit documentation files against source code for inaccuracies
---

## Documentation Audit

Audit all markdown documentation files under `docs/` and `spec/` against the actual source code.

For each doc file:

1. Extract every claim about UI elements, icons, button names, component behaviors, and feature descriptions
2. Search the source code to verify each claim is accurate
3. Flag any references to removed features, wrong icon names, incorrect file paths, or outdated workflows
4. Produce a structured report as a markdown table with columns: Doc File | Line | Claim | Source Evidence | Status (correct/outdated/wrong/missing)
5. For each issue found, draft the corrected documentation text

Do NOT modify any files — output the full audit report first so the user can review before applying changes.
