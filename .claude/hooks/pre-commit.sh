#!/usr/bin/env bash
# Pre-commit hook for Claude Code
# Runs type-checking and unit tests before any git commit

set -euo pipefail

# Read JSON input from stdin
input=$(cat)

# Extract the command string from the tool_input.command field
command=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# Only run checks for git commit commands
if [[ "$command" != *"git commit"* ]]; then
  exit 0
fi

echo "Pre-commit hook: running type-checking and tests..." >&2

errors=()

# Type-check ae-skos
echo "Type-checking ae-skos..." >&2
if ! pnpm --filter ae-skos vue-tsc --noEmit 2>&1; then
  errors+=("ae-skos type-check failed")
fi

# Type-check ae-rdf
echo "Type-checking ae-rdf..." >&2
if ! pnpm --filter ae-rdf vue-tsc --noEmit 2>&1; then
  errors+=("ae-rdf type-check failed")
fi

# Unit tests for ae-skos (ae-rdf has no tests yet)
echo "Running ae-skos tests..." >&2
if ! pnpm --filter ae-skos test:run 2>&1; then
  errors+=("ae-skos tests failed")
fi

if [ ${#errors[@]} -gt 0 ]; then
  echo "" >&2
  echo "Pre-commit hook FAILED:" >&2
  for err in "${errors[@]}"; do
    echo "  - $err" >&2
  done
  exit 2
fi

echo "Pre-commit hook passed." >&2
exit 0
