---
mode: agent
description: Review the current diff against hsooligan95.github.io's invariants
---

Review my current diff against this repo's invariants:

- Static site: no build step, no framework, and no external assets — everything the page needs ships in this repo.
- canonical.js must stay byte-compatible with the Python verifier in agent-trace; prove any change with tools/verify_js_canonical.mjs.
- data/drill.js, data/chain.js, and data/feed.js are generated artifacts — regenerate with tools/gen_data.py / tools/gen_feed.py, never hand-edit.
- No title-forward copy, and every number on the page comes from a real recorded run — never invent or round a figure.

Flag every violation with file and line. Also flag any change that
alters a documented behavior contract (output shapes, exit codes,
event schemas, recorded artifacts) without updating the docs and
tests that describe it. No style nitpicks — correctness and contract
violations only.
