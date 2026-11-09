#!/usr/bin/env bash
# Generate a token-efficient symbol map of the codebase

echo "=== FILE STRUCTURE ==="
tree -L 3 -I 'node_modules|target|dist|.git|.agents|.codex'

echo -e "\n=== TYPESCRIPT & RUST SYMBOLS ==="
# Uses ctags to pull only declarations (functions, classes, interfaces, types)
ctags -R -f - --languages=TypeScript,JavaScript,Rust \
  --exclude=node_modules --exclude=target --exclude=dist --exclude=.git \
  --fields=+nK \
  --output-format=json . | jq -r '[.name, .kind, .path + ":" + (.line|tostring)] | @tsv' | column -t
