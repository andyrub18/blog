---
description: Measure the client bundle against the 100 KB first-load budget
---

Build the app and report client bundle weight against the project budget.

1. Run `npm run build`.
2. Total the gzipped client JS:

```bash
find .output/public/assets -name '*.js' | while read f; do gzip -c "$f" | wc -c; done \
  | awk '{s+=$1} END {printf "total client JS gzipped: %.1f KB\n", s/1024}'
```

3. List the five largest chunks gzipped:

```bash
find .output/public/assets -name '*.js' | while read f; do
  echo "$(gzip -c "$f" | wc -c) $(basename $f)"; done | sort -rn | head -5 \
  | awk '{printf "  %6.1f KB  %s\n", $1/1024, $2}'
```

Report the total and the largest chunks. The budget is **under 100 KB gzipped
for an article page**. If a chunk looks unexpectedly large, identify what is in
it before suggesting a fix — a server library leaking into the client bundle has
happened before and is the first thing to rule out:

```bash
for m in better-auth kysely drizzle postgres; do
  printf "%-14s %s\n" "$m" "$(grep -c "$m" <CHUNK> 2>/dev/null)"; done
```

State plainly whether the budget is met. Do not "fix" anything without saying
what you found first.
