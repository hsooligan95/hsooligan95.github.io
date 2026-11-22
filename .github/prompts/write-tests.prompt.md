---
mode: agent
description: Write tests for a named module in hsooligan95.github.io
---

Write tests for the module I name, following this repo's existing test
style, layout, and fixtures. Cover the behavior the module documents,
including these invariants where they apply:

- Static site: no build step, no framework, and no external assets — everything the page needs ships in this repo.
- canonical.js must stay byte-compatible with the Python verifier in agent-trace; prove any change with tools/verify_js_canonical.mjs.
- data/drill.js, data/chain.js, and data/feed.js are generated artifacts — regenerate with tools/gen_data.py / tools/gen_feed.py, never hand-edit.

Then run the test suite:

    python tools/verify_site.py
node tools/verify_js_canonical.mjs

Show the result. Do not claim done unless the suite is green; if a
test cannot pass, say why instead of weakening the assertion.
