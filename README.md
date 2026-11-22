# hsooligan95.github.io

Andrew Hsu's developer site: a static page presenting a set of AI agent
platform projects — the fleet graph, an agent ops feed that replays
recorded runs as an agent group chat, and a live tamper-evidence demo —
with links to each project's GitHub repository.

Live at https://hsooligan95.github.io/

## Static, no build step

Plain HTML, CSS, and JavaScript. No framework, no bundler, no build:
open `index.html` or serve the directory and it runs as-is.

- `index.html`, `style.css`, `app.js` — the page itself
- `canonical.js` — canonical JSON serialization matching the Python
  implementation used by agent-trace, so browser-side hashes agree
  byte-for-byte with the stored events
- `data/projects.js` — the project list rendered into the fleet graph
- `data/feed.js` — the ops-feed scripts: the platform drill condensed
  from the drill store, the MissionControl incident-arbitration
  scenario parsed from its suite report, and the AgentFlightSim
  stale-corpus batch parsed from that repo's shipped run
- `data/drill.js`, `data/chain.js` — the run data behind the tamper demo

## Where the data comes from

`data/drill.js` and `data/chain.js` are generated, not hand-written.
`tools/gen_data.py` reads the real agent-trace drill store
(`trace-drill-45d404d0`: 117 events, six producers, total cost $0.57313)
and derives the event rows, beat positions, per-producer counts, and the
chain events from it, asserting the known totals before writing anything.

## The tamper demo verifies the chain live

The demo carries real events from that store, hash-chained with SHA-256.
In the browser, the page recomputes the chain over the events as loaded —
editing any character of any event in the demo and re-verifying makes the
check fail at exactly that event's position, the same result the Python
and Rust verifiers produce on the same store.

## Tools

- `tools/gen_data.py` — regenerate `data/drill.js` and `data/chain.js`
  from the agent-trace drill store
- `tools/gen_feed.py` — regenerate `data/feed.js` (asserts the drill
  totals and parses the MissionControl decision record before writing)
- `tools/verify_js_canonical.mjs` — check the browser canonicalization
  against the Python reference
- `tools/verify_site.py` — full browser verification: graph, tamper
  demo, and all three ops-feed channels played end-to-end
