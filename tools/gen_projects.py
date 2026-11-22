#!/usr/bin/env python3
"""Assert the facts in data/projects.js against the repos themselves.

Hand-curated data rots; this script is the fence. For every project it
derives the test/eval count from the repo (README statement, test-file
count, pytest collection, smoke-script assertions, or the eval case
file) and compares it with the number published in data/projects.js.
It also asserts the portfolio shape: exactly 15 projects, every
"talks" target exists, every project carries a provider tag, and the
retired pulumi-serverless-stack appears nowhere in the data.

Run: python3 tools/gen_projects.py   (exit 1 on any mismatch)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
REPOS = SITE.parent  # ~/workspace/github-portfolio

raw = (SITE / "data" / "projects.js").read_text()
assert "pulumi" not in raw.lower(), "pulumi must not appear in projects.js"
m = re.search(r"window\.PROJECTS = (\[.*\]);\s*$", raw, re.S)
assert m, "could not locate window.PROJECTS"
projects = json.loads(m.group(1))
by_id = {p["id"]: p for p in projects}

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + extra) if extra else ""))
    if not cond:
        fails.append(name)

check("exactly 15 projects", len(projects) == 15, str(len(projects)))
check("no pulumi project", "pulumi-serverless-stack" not in by_id)
for p in projects:
    check(p["id"] + ": provider tag present", bool(p.get("provider")), p.get("provider", ""))
    check(p["id"] + ": rich fields present",
          all(p.get(k) for k in ("purpose", "unique", "consumes", "produces")))
    for t in p.get("talks", []):
        check(p["id"] + " talks -> " + t, t in by_id)

def readme_tests(repo):
    text = (REPOS / repo / "README.md").read_text()
    mm = re.search(r"(\d+)\s+(?:pytest\s+)?tests", text)
    return int(mm.group(1)) if mm else None

def readme_passed(repo):
    text = (REPOS / repo / "README.md").read_text()
    mm = re.search(r"(\d+)\s+passed", text)
    return int(mm.group(1)) if mm else None

def def_test_count(repo):
    total = 0
    for f in (REPOS / repo / "tests").glob("*.py"):
        total += len(re.findall(r"def test", f.read_text()))
    return total

def pytest_collect_count(repo):
    py = REPOS / repo / ".venv" / "bin" / "python"
    out = subprocess.run([str(py), "-m", "pytest", "tests/", "--collect-only", "-q"],
                         cwd=REPOS / repo, capture_output=True, text=True)
    mm = re.search(r"(\d+) tests collected", out.stdout)
    return int(mm.group(1)) if mm else None

def smoke_assert_count(repo):
    """Executed assertions in the MCP smoke script: assert() call sites,
    with the tools/list loop counted once per expected tool name."""
    src = (REPOS / repo / "scripts" / "smoke-test.mjs").read_text()
    sites = len(re.findall(r"assert\(", src)) - 1  # minus the helper definition
    loop = re.search(r"for \(const expected of \[(.*?)\]\)", src, re.S)
    names = len(re.findall(r'"[a-z_]+"', loop.group(1))) if loop else 1
    return sites - 1 + names  # the loop's one call site runs `names` times

def jsonl_count(repo, rel):
    lines = [l for l in (REPOS / repo / rel).read_text().splitlines() if l.strip()]
    return len(lines)

EXPECTED = {
    "factory-floor-agent":    lambda: readme_tests("factory-floor-agent"),
    "context-vault":          lambda: readme_tests("context-vault"),
    "mcp-cloud-explorer":     lambda: smoke_assert_count("mcp-cloud-explorer"),
    "agent-gate":             lambda: readme_tests("agent-gate"),
    "cred-broker":            lambda: readme_tests("cred-broker"),
    "agent-canary":           lambda: def_test_count("agent-canary"),
    "agent-chaos":            lambda: readme_tests("agent-chaos"),
    "agent-flightsim":        lambda: pytest_collect_count("agent-flightsim"),
    "rag-evaluation-harness": lambda: jsonl_count("rag-evaluation-harness", "evals/cases.jsonl"),
    "blast-radius":           lambda: readme_passed("blast-radius"),
    "mission-control":        lambda: readme_tests("mission-control"),
    "agent-ledger":           lambda: readme_tests("agent-ledger"),
    "agent-trace":            lambda: readme_tests("agent-trace"),
    "agentcore-port":         lambda: readme_tests("agentcore-port"),
    "ato-in-a-box":           lambda: readme_tests("ato-in-a-box"),
}

for pid, derive in EXPECTED.items():
    want = derive()
    published = by_id[pid]["tests"]
    got = int(re.match(r"\d+", published).group(0))
    check(pid + ": published count matches repo", want == got,
          "repo=%s published=%r" % (want, published))

print("RESULT:", "FAIL " + str(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
