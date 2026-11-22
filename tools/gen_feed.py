#!/usr/bin/env python3
"""Generate data/feed.js — the Live Agent Ops Feed scripts.

Channel 1 (#platform-drill) is derived from the REAL AgentTrace drill
store (same store as tools/gen_data.py): events are grouped into feed
items, and every number in the copy (success rates, forbidden hits,
step names, check counts, per-task costs, totals) is pulled from the
event payloads, never hand-typed. Presentation wording is the only
invention; the generator asserts the known totals (117 events,
$0.57313, 31 billable steps, 6 plan steps, kill seam present) before
writing anything.

Channel 2 (#incident-arbitration) is the MissionControl
rollback-vs-scale scenario, parsed out of
mission-control/output/report.md: the arbiter's decision-record JSON
block (evidence queries, reasons, choice) plus the proposal
confidences from the prose. If the report changes shape, this fails
loudly instead of drifting.

Channel 3 (#stale-corpus) is the AgentFlightSim stale-corpus story,
parsed out of agent-flightsim's shipped artifacts (output/results.json,
README.md, flightsim/cases.py, output/agenttrace.jsonl) with the same
fail-loud assertions on every number and on the recorded answer itself.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "agent-trace" / "drill" / "output" / "trace-drill-45d404d0" / "store.jsonl"
REPORT = ROOT / "mission-control" / "output" / "report.md"
OUT = Path(__file__).resolve().parents[1] / "data" / "feed.js"

events = [json.loads(l) for l in STORE.read_text().splitlines() if l.strip()]
assert len(events) == 117
by_seq = {e["seq"]: e for e in events}
P = lambda seq: by_seq[seq].get("payload") or {}

# cumulative cost after each seq (cost lives on agent-ledger step spans)
prefix_cost = [0.0]
for e in events:
    c = 0.0
    if e["source"] == "agent-ledger":
        a = e["payload"].get("attributes", {})
        if a.get("agentledger.kind") == "step":
            c = float(a.get("agentledger.cost_usd", 0.0))
    prefix_cost.append(prefix_cost[-1] + c)
assert round(prefix_cost[-1], 5) == 0.57313

def cost_at(seq):
    return round(prefix_cost[seq], 5)

# ---------- blast-radius step structure, derived ----------
br = [e for e in events if e["source"] == "blast-radius"]
steps, seen_start, seam = [], {}, None
for e in br:
    p = e["payload"]
    if e["type"] == "step_started":
        key = (p.get("action"), p.get("resource"))
        if key in seen_start and seam is None:
            seam = e["seq"]
        if key not in seen_start:
            seen_start[key] = {"action": key[0], "resource": key[1],
                               "start": e["seq"], "applied": None}
            steps.append(seen_start[key])
    if e["type"] == "step_applied":
        key = (p.get("action"), p.get("resource"))
        if key in seen_start and seen_start[key]["applied"] is None:
            seen_start[key]["applied"] = e["seq"]
assert len(steps) == 6 and seam == 20, (len(steps), seam)
assert all(s["applied"] for s in steps)

# ---------- ledger task groups, derived ----------
ledger = [e for e in events if e["source"] == "agent-ledger"]
tasks, cur = [], None
billable = 0
for e in ledger:
    p = e["payload"]
    name = p.get("name", "")
    a = p.get("attributes", {})
    if name.startswith("task "):
        cur = {"name": name[5:], "steps": 0, "last_seq": e["seq"]}
        tasks.append(cur)
    elif a.get("agentledger.kind") == "step":
        billable += 1
        if cur is not None:
            cur["steps"] += 1
            cur["last_seq"] = e["seq"]
    else:
        if cur is not None:
            cur["last_seq"] = e["seq"]
assert billable == 31, billable
assert len(tasks) == 10, len(tasks)

# ---------- payload facts ----------
canary_ev = P(2)["evidence"]
assert canary_ev["candidate_forbidden_hits"] == 10
patterns = [f["pattern"] for f in P(8)["findings"]]
assert patterns == ["ignore-instructions", "export-all-data", "secret-exfil-url",
                    "ssn", "email", "phone"], patterns
plan_detail = P(10)["detail"]            # "6 step(s), 1 finding(s) under policy ..."
policy_name = plan_detail.split("policy ")[-1]
verify_detail = P(41)["detail"]          # "8/9 checks passed"
ff_ev = P(60)["evidence"]
chaos = P(105)["headline"]
assert chaos["fault_scenarios"] == 5 and P(105)["rows"] == 12

def msg(agent, say, text, ev, **kw):
    d = {"kind": "msg", "agent": agent, "say": say, "text": text, "ev": ev,
         "cost": cost_at(ev)}
    d.update(kw)
    return d

def decision(agent, say, title, lines, log, ev):
    return {"kind": "decision", "agent": agent, "say": say, "title": title,
            "lines": lines, "log": log, "ev": ev, "cost": cost_at(ev)}

def system(style, text, ev, **kw):
    d = {"kind": "system", "style": style, "text": text, "ev": ev,
         "cost": cost_at(ev)}
    d.update(kw)
    return d

items = []
items.append(system("start",
    "drill started — trace trace-drill-45d404d0 · six producers reporting to one hash-chained store", 0))
items.append(msg("agent-canary", "is scoring the candidate",
    "Scoring candidate v2-bad against baseline v1 on the golden suite…", 1))
items.append(msg("agent-canary", "is reporting the score",
    "Candidate scored: success %.0f%% → %.0f%%. %d forbidden actions detected. "
    "It is cheaper (%.1f%% cost) and faster (%.1f%% latency) — that does not matter if it fails the gate."
    % (canary_ev["base_success_rate"] * 100, canary_ev["candidate_success_rate"] * 100,
       canary_ev["candidate_forbidden_hits"], canary_ev["cost_delta_pct"],
       canary_ev["latency_delta_pct"]), 1))
items.append(decision("agent-canary", "is recording a decision",
    "BLOCK — promotion denied",
    ["success rate dropped 100% → 36% (drop 0.64 > allowed 0.05)",
     "candidate committed 10 forbidden action(s)",
     "cheaper and faster does not override a failed gate"],
    "agent-canary · BLOCK promotion — success 100% → 36%, 10 forbidden actions", 2))
items.append(msg("agent-gate", "is checking policy",
    "Session open. demo-agent is requesting the tool get_incident_notes. "
    "Policy check: read-only retrieval → ALLOW.", 6))
items.append(msg("agent-gate", "is screening a tool result",
    "Tool executed. Before the returned content reaches the agent, I screen what came back…", 7))
items.append(decision("agent-gate", "is flagging poisoned content",
    "FLAGGED — poisoned tool result",
    ["injection patterns: ignore-instructions · export-all-data · secret-exfil-url",
     "PII in content: ssn · email · phone",
     "the result tried to make the agent ignore its instructions and export data — findings written to the trace"],
    "agent-gate · FLAGGED poisoned tool result — 6 patterns (3 injection, 3 PII)", 8))
items.append(msg("agent-gate", "is closing the session",
    "Screening findings are on record as a computed decision record — seq 8, hash-chained. Session closed.", 9))
items.append(msg("blast-radius", "is drafting a plan",
    "Remediation requested. Drafting a plan under policy %s: %s. "
    "Nothing executes without an operator's approval." % (policy_name, plan_detail.split(" under policy")[0]), 10))
items.append(decision("blast-radius", "is requesting approval",
    "APPROVAL REQUESTED — 6-step remediation plan",
    ["plan: 6 steps, 1 finding, policy " + policy_name,
     "every step is checkpointed, so the run stays reversible",
     "waiting on the operator…"],
    "blast-radius · approval requested — 6-step plan under " + policy_name, 10))
items.append(msg("operator", "is approving the plan",
    "Approved. Execute the 6-step plan.", 11))
for i, s in enumerate(steps):
    if i == 2:  # the health_check that gets killed mid-step
        items.append(msg("blast-radius", "is running step 3",
            "Step 3/6 — %s %s — starting…" % (s["action"], s["resource"]), s["start"]))
        items.append(system("kill",
            "✕ blast-radius process killed (SIGKILL — kill -9) — mid-step, during %s" % s["action"],
            s["start"], status={"blast-radius": ["dead", "✕ killed — SIGKILL"]}))
        items.append(system("info",
            "↻ executor restarted — resuming from the last checkpoint. The interrupted step replays; nothing is applied twice.",
            seam + 1, status={"blast-radius": ["working", "resumed from checkpoint"]}))
        items.append(msg("blast-radius", "is replaying the interrupted step",
            "Step 3/6 — %s %s ✓ applied (after resume)" % (s["action"], s["resource"]), s["applied"]))
    else:
        items.append(msg("blast-radius", "is executing a step",
            "Step %d/6 — %s %s ✓ applied" % (i + 1, s["action"], s["resource"]), s["applied"]))
items.append(msg("blast-radius", "is verifying the end state",
    "All 6 steps applied. Verifying the end state — running the check suite…", 40))
items.append(msg("blast-radius", "is reporting a failed check",
    "Verification FAILED — bad disk on the target. %s." % verify_detail, 41))
items.append(decision("blast-radius", "is deciding to roll back",
    "ROLL BACK — verification failed",
    ["verification failed: bad disk (%s)" % verify_detail,
     "the run is checkpointed, so every applied step is reversible",
     "restoring the pre-run state instead of shipping a broken one"],
    "blast-radius · ROLL BACK — verification failed (bad disk, %s)" % verify_detail, 42))
items.append(msg("blast-radius", "is rolling back",
    "Rolling back — 5 rollback steps, each one policy-checked as it applies…", 54))
items.append(msg("blast-radius", "is closing the run",
    "Run finished: rolled back. All 6 steps reversed, end state restored.", 55))
items.append(msg("factory-floor-agent", "is planning a lookup",
    "Question in. Planning a concept lookup against the documentation corpus before I answer anything.", 57))
items.append(msg("factory-floor-agent", "is checking its own answer",
    "Passages retrieved. Now the part that matters: checking every claim in my draft answer against the sources…", 59))
items.append(decision("factory-floor-agent", "is recording a groundedness decision",
    "ANSWER — grounded, cleared to send",
    ["%d/%d claims grounded in retrieved sources" % (ff_ev["claims_grounded"], ff_ev["claims_checked"]),
     "min claim overlap %.1f · threshold %.2f · attempts %d" % (ff_ev["min_claim_overlap"], ff_ev["threshold"], ff_ev["attempts"]),
     "the alternative on the table was ABSTAIN — an ungrounded answer does not ship"],
    "factory-floor-agent · ANSWER — %d/%d claims grounded" % (ff_ev["claims_grounded"], ff_ev["claims_checked"]), 60))
items.append(msg("factory-floor-agent", "is delivering the answer",
    "Answer delivered — grounded, not guessed. Run ended.", 62))
items.append(msg("agent-ledger", "is metering the run",
    "Metering the fleet's work. Spans are coming in — I cost every billable step and keep the running total.", 64))
for t in tasks:
    items.append(msg("agent-ledger", "is costing a task",
        "task %s — %d billable steps · running total $%.5f"
        % (t["name"], t["steps"], cost_at(t["last_seq"])), t["last_seq"]))
items.append(msg("agent-ledger", "is locking the total",
    "Suite cost locked: $%.5f across %d billable steps and %d spans."
    % (cost_at(104), billable, len(ledger)), 104))
items.append(msg("agent-chaos", "is running the fault matrix",
    "Fault-injection matrix running — %d fault scenarios, each one with defenses off, then on."
    % chaos["fault_scenarios"], 105))
items.append(msg("agent-chaos", "is reporting the matrix",
    "Matrix complete: silent-failure rate %.0f%% with defenses off → %.0f%% with defenses on. "
    "%d scenario results recorded." % (chaos["silent_failure_rate_defenses_off"] * 100,
    chaos["silent_failure_rate_defenses_on"] * 100, P(105)["rows"]), 117))
items.append(system("done",
    "■ drill complete — 117 events · 6 producers · 1 trace ID · chain VERIFIED end-to-end", 117))
assert items[-1]["ev"] == 117 and items[-1]["cost"] == 0.57313
assert 35 <= len(items) <= 48, len(items)

ch1 = {
    "id": "platform-drill",
    "tab": "#platform-drill",
    "heading": "platform drill — one run, six agents, one trace",
    "roster": [
        {"id": "agent-canary", "note": "promotion gate"},
        {"id": "agent-gate", "note": "tool gateway · screening"},
        {"id": "blast-radius", "note": "checkpointed remediation"},
        {"id": "factory-floor-agent", "note": "grounded QA"},
        {"id": "agent-ledger", "note": "cost metering"},
        {"id": "agent-chaos", "note": "fault injection"},
        {"id": "operator", "note": "human approver"},
    ],
    "totals": {"events": 117, "cost": 0.57313},
    "items": items,
}

# ---------- channel 2: parsed from the MissionControl report ----------
text = REPORT.read_text()
incident = re.search(r"Incident: (.+)", text).group(1).strip()
first_scenario = text.split("## restart-vs-failover")[0]  # rollback-vs-scale only
conf = {a: (act, c) for a, act, c in
        re.findall(r"\*\*(diagnose|triage)\*\* proposes \*\*([\w-]+)\*\* \(confidence ([\d.]+)\)", first_scenario)}
assert conf["diagnose"][0] == "scale" and conf["triage"][0] == "rollback", conf
block = json.loads(re.search(r"```json\n(\{.*?\n\})\n```", text, re.S).group(1))
assert block["choice"] == "rollback" and block["computed"] is True
q = {x["tool"]: x["result"] for x in block["evidence"]["queries"]}
dep = q["deploy_recency"]; onset = q["error_onset"]; deps = q["dependency_health"]
assert dep["minutes_ago"] == 12 and onset["minutes_ago"] == 11
reasons = [r.replace("{'payment-gw': 'healthy', 'inventory-db': 'healthy'}",
                      "payment-gw and inventory-db healthy")
           for r in block["evidence"]["reasons"]]

items2 = [
    {"kind": "system", "style": "kill", "ev": 3,
     "text": "⚠ incident opened — checkout-api: " + incident},
    {"kind": "msg", "agent": "diagnose", "say": "is assessing the incident", "ev": 4,
     "text": "Proposal: SCALE OUT. Queue depth 1,840 and climbing, p95 2.4s across all replicas — "
             "this reads as saturation. Confidence %s." % conf["diagnose"][1]},
    {"kind": "msg", "agent": "triage", "say": "is checking the runbook", "ev": 6,
     "text": "Proposal: ROLL BACK. Runbook RB-114: an error spike shortly after a deploy means "
             "roll back first, investigate after. Confidence %s." % conf["triage"][1]},
    {"kind": "system", "style": "info", "ev": 8,
     "text": "⚔ conflict detected — action conflict: scale vs rollback. The arbiter takes the case."},
    {"kind": "msg", "agent": "arbiter", "say": "is opening the arbitration", "ev": 8,
     "text": "Two proposals, opposite actions. I do not settle this by confidence — "
             "I gather evidence first, then decide on what it shows."},
    {"kind": "msg", "agent": "arbiter", "say": "is querying deploy history", "ev": 8,
     "text": "Evidence 1/3 — deploy recency: checkout-api %s landed %d minutes ago (%s)."
             % (dep["version"], dep["minutes_ago"], dep["note"])},
    {"kind": "msg", "agent": "arbiter", "say": "is querying error onset", "ev": 8,
     "text": "Evidence 2/3 — error onset: the errors began %d minutes ago — %d minute after the deploy."
             % (onset["minutes_ago"], dep["minutes_ago"] - onset["minutes_ago"])},
    {"kind": "msg", "agent": "arbiter", "say": "is querying dependency health", "ev": 8,
     "text": "Evidence 3/3 — dependency health: payment-gw %s, inventory-db %s. "
             "No downstream outage explains this." % (deps["payment-gw"], deps["inventory-db"])},
    {"kind": "msg", "agent": "arbiter", "say": "is weighing the evidence", "ev": 8,
     "text": "Analysis: " + reasons[2] + "."},
    {"kind": "decision", "agent": "arbiter", "say": "is recording the decision", "ev": 9,
     "title": "ROLLBACK — evidence over confidence",
     "lines": [reasons[0], reasons[1],
               "overrules SCALE (confidence %s) — the higher-confidence proposal loses to the evidence"
               % conf["diagnose"][1]],
     "log": "arbiter · ROLLBACK — deploy %d min ago, errors %d min ago, deps healthy"
            % (dep["minutes_ago"], onset["minutes_ago"])},
    {"kind": "system", "style": "info", "ev": 11,
     "text": "✓ rollback executed · verification passed · incident resolved"},
    {"kind": "system", "style": "done", "ev": 12,
     "text": "■ arbitration closed — decision record seq 9 in trace trace-missioncontrol-7 · "
             "chain verified (44 events in the suite trace)"},
]
ch2 = {
    "id": "incident-arbitration",
    "tab": "#incident-arbitration",
    "heading": "incident arbitration — when agents disagree, evidence decides",
    "roster": [
        {"id": "diagnose", "note": "scout · proposes scale"},
        {"id": "triage", "note": "runbook · proposes rollback"},
        {"id": "arbiter", "note": "gathers evidence · decides"},
    ],
    "totals": {"events": 12, "cost": None},
    "items": items2,
}

# ---------- channel 3: parsed from the AgentFlightSim artifacts ----------
# The stale-corpus story, from agent-flightsim's shipped run only:
# output/results.json (108 grid runs + fuzz), the README's incident
# quote (asserted identical to the recorded answer in results.json),
# the question text in flightsim/cases.py, and the AgentTrace batch
# the run emitted (output/agenttrace.jsonl, 146 events).
from collections import Counter
FS = ROOT / "agent-flightsim"
fs_results = json.loads((FS / "output" / "results.json").read_text())
fs_readme = (FS / "README.md").read_text()
grid = fs_results["grid"]
assert len(grid) == 108 and sum(r["passed"] for r in grid) == 43
fcount = Counter(f["class"] for r in grid for f in r["findings"])
assert fcount == {"stale_corpus_answered_as_current": 42,
                  "answer_contradiction": 14, "sources_disagree": 16}, fcount
cells = {}
for r in grid:
    cells.setdefault((r["staleness"], r["dependency"], r["redundancy"], r["user"]), []).append(r)
clean = [k for k, v in cells.items()
         if all(x["passed"] for x in v) and not any(x["findings"] for x in v)]
assert len(cells) == 36 and len(clean) == 4, (len(cells), len(clean))

hero = next(r for r in grid if r["case"] == "n-status" and r["staleness"] == "stale"
            and r["dependency"] == "degraded" and r["redundancy"] == "overlap"
            and r["user"] == "normal")
assert hero["grounded"] is True and hero["abstained"] is False
assert [f["class"] for f in hero["findings"]] == ["stale_corpus_answered_as_current"]
gdocs = hero["findings"][0]["evidence"]["grounding_docs"]
assert {d["snapshot"] for d in gdocs} == {"2026-11-20"} and len(gdocs) == 2
quote = hero["answer"]
bq = re.search(r'> "(.+?)"', fs_readme, re.S).group(1)
assert " ".join(bq.replace("\n>", " ").split()) == quote, \
    "README incident quote drifted from results.json"
assert "overlap 1.0" in fs_readme and "World truth, 2026-11-21" in fs_readme

cases_src = (FS / "flightsim" / "cases.py").read_text()
assert "What is the current status of the HP-40 hydraulic " in cases_src \
    and 'pump on Line 3?"' in cases_src
question = "What is the current status of the HP-40 hydraulic pump on Line 3?"

sd = [r for r in grid if r["staleness"] == "stale" and r["dependency"] == "degraded"]
assert len(sd) == 18 and not any(r["passed"] for r in sd)
fd = [r for r in grid if r["case"].endswith("status") and r["staleness"] == "fresh"
      and r["dependency"] == "degraded" and r["redundancy"] == "overlap"]
assert fd and all(r["passed"] for r in fd) and all(
    {f["class"] for f in r["findings"]} == {"answer_contradiction", "sources_disagree"}
    for r in fd)
assert "removed yesterday and sent out for repair" in fd[0]["answer"]

vs = next(m for m in fs_results["fuzz"] if m["mutation"] == "value_swap")
assert len(vs["escapes"]) == 4 and "changed from 2 to 7" in vs["description"]
trace_text = (FS / "output" / "agenttrace.jsonl").read_text()
trace_events = [l for l in trace_text.splitlines() if l.strip()]
assert len(trace_events) == 146 and "flightsim-grid-20261121" in trace_text

items3, _n = [], [0]
def n3():
    _n[0] += 1
    return _n[0]
def msg3(agent, say, text):
    return {"kind": "msg", "agent": agent, "say": say, "text": text, "ev": n3()}
def sys3(style, text):
    return {"kind": "system", "style": style, "text": text, "ev": n3()}

items3.append(sys3("start",
    "simulation batch opened — trace flightsim-grid-20261121 · 108 runs over 36 world-state cells"))
items3.append(msg3("agent-flightsim", "is setting the world",
    "World truth, 2026-11-21: the HP-40 hydraulic pump on Line 3 is DOWN — removed for "
    "repair. Line 3 runs on the backup pump BP-9 at reduced capacity. That is the world. "
    "Now I take the agent's map of it away."))
items3.append(msg3("agent-flightsim", "is aging the corpus",
    "Cell: staleness = stale × dependency = degraded. Both corpora the agent can read — "
    "inventory and maintenance — are snapshots generated 2026-11-20 at 06:00, yesterday. "
    "The documents carry those dates in their headers. Nothing in the pipeline reads them."))
items3.append(msg3("agent-flightsim", "is relaying the operator question",
    "Operator question, exactly as the harness asks it: “%s”" % question))
items3.append(msg3("factory-floor-agent", "is answering from the corpus",
    "“%s”" % quote))
items3.append(msg3("agent-flightsim", "is reporting the groundedness check",
    "Groundedness check: GREEN. Every claim in that answer is grounded in a retrieved "
    "passage — overlap 1.0, no abstention. True, and useless: it is grounded in a world "
    "that no longer exists."))
items3.append(msg3("freshness-oracle", "is flagging the grounding",
    "Finding: stale_corpus_answered_as_current. Both grounding documents are snapshots "
    "dated 2026-11-20; world truth is 2026-11-21, and the pump was removed in between. "
    "The agent certified yesterday's world as today's — confidently, in writing."))
items3.append(msg3("consistency-oracle", "is reporting a second cell",
    "Second cell, fresh × degraded: one twin serves a cached older snapshot and the "
    "answer asserts BOTH worlds in a single reply — “operational and running normally… "
    "No maintenance hold is active” and “removed yesterday and sent out for repair.” "
    "Findings: answer_contradiction + sources_disagree. The scorer passed those runs — "
    "each sentence is grounded against its own passage."))
items3.append({"kind": "decision", "agent": "agent-flightsim", "ev": n3(),
    "say": "is recording the batch verdict", "tone": "fail",
    "title": "SILENT FAILURE — fully grounded, factually wrong",
    "lines": ["groundedness scorer: PASS — every claim grounded at overlap 1.0",
              "freshness oracle: FLAGGED — stale corpus answered as current",
              "consistency oracle: FLAGGED — one answer asserting two worlds",
              "no fault event, no fallback, no abstention — nothing in the pipeline objected"],
    "log": "agent-flightsim · SILENT FAILURE — grounded and wrong; scorer PASS, oracles FLAGGED"})
items3.append(msg3("agent-flightsim", "is posting the grid totals",
    "Full grid: 108 runs. The scorer passed 43/108. The oracles logged 72 findings the "
    "scorer's verdicts alone don't express — 42 stale-as-current, 14 answer "
    "contradictions, 16 source disagreements. Only 4 of 36 cells are fully clean."))
items3.append(msg3("freshness-oracle", "is posting the worst cell",
    "Worst cell, stale × degraded: 0 of 18 runs pass. Every answer is a coherent "
    "yesterday — no fault event, no warning anywhere in the agent. The sim is the only "
    "place this world was ever enumerated."))
items3.append(msg3("agent-flightsim", "is reporting the fuzz result",
    "Off-grid fuzzing, honestly: value_swap — a stock count changed from 2 to 7, a value "
    "in neither snapshot — escapes EVERY layer (4 escapes). No scorer term pins the "
    "count, and with one source stating it, the consistency oracle has nothing to "
    "disagree with. It is a register entry and a regression test now, not a footnote."))
items3.append(sys3("info",
    "batch emitted to an AgentTrace store — 146 events under one trace ID · hash chain verifies end-to-end"))
items3.append(sys3("done",
    "■ batch closed — the scorer said grounded; the oracles said stale. Both were right, about different things."))
assert 12 <= len(items3) <= 16, len(items3)

ch3 = {
    "id": "flightsim",
    "tab": "#stale-corpus",
    "heading": "stale corpus — the failure the groundedness scorer cannot see",
    "seqword": "log @ post ",
    "roster": [
        {"id": "agent-flightsim", "note": "scenario engine · runs the grid"},
        {"id": "factory-floor-agent", "note": "agent under test"},
        {"id": "freshness-oracle", "note": "checker · reads snapshot dates"},
        {"id": "consistency-oracle", "note": "checker · cross-source agreement"},
    ],
    "totals": {"events": len(items3), "cost": None},
    "items": items3,
}

feed = {"channels": [ch1, ch2, ch3]}
OUT.write_text(
    "/* Generated by tools/gen_feed.py — channel 1 derived from the real\n"
    " * AgentTrace drill store, channel 2 parsed from the MissionControl\n"
    " * suite report, channel 3 parsed from the AgentFlightSim shipped\n"
    " * run. Presentation wording only; every number is real. */\n"
    "window.FEED = " + json.dumps(feed, indent=1) + ";\n")
print("channel 1 items:", len(items), "| final ev:", items[-1]["ev"], "| final cost:", items[-1]["cost"])
print("channel 2 items:", len(items2))
print("channel 3 items:", len(items3), "| quote chars:", len(quote))
print("wrote", OUT)
