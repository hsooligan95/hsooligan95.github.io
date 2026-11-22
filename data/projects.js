/* Project facts for Andrew Hsu's portfolio. Every number here is taken
 * from the project's own README / verified run records. */
window.LAYERS = ["Run", "Govern", "Prove", "Execute", "Meter", "Trace", "Deploy", "Comply"];

window.PROJECTS = [
  {
    id: "factory-floor-agent", name: "factory-floor-agent", layer: "Run",
    one: "LangGraph QA agent: plan, retrieve, answer, then a groundedness check - retry, or abstain.",
    stack: "Python - LangGraph - BM25/TF-IDF retrieval",
    tests: "5 tests",
    result: "Answers only from retrieved passages, with citations. When the evidence isn't there, it abstains instead of guessing.",
    url: "https://github.com/hsooligan95/factory-floor-agent"
  },
  {
    id: "context-vault", name: "context-vault", layer: "Run",
    one: "Versioned shared context for multi-agent systems: provenance on every entry, nothing silently overwritten.",
    stack: "Python - SQLite - stdlib only",
    tests: "21 tests",
    result: "A stale-base write is preserved as a conflicted version and the head never moves; secret patterns are refused at write time.",
    url: "https://github.com/hsooligan95/context-vault"
  },
  {
    id: "mcp-aws-explorer", name: "mcp-aws-explorer", layer: "Run",
    one: "MCP server exposing read-only AWS inventory and cost tools over a local mock dataset.",
    stack: "TypeScript - MCP SDK - Zod",
    tests: "8/8 smoke checks",
    result: "Full MCP handshake and every tool exercised end-to-end over stdio - zero credentials, zero network calls.",
    url: "https://github.com/hsooligan95/mcp-aws-explorer"
  },
  {
    id: "agent-gate", name: "agent-gate", layer: "Govern",
    one: "Security gateway for MCP: per-agent tool allowlists, allow / deny / require-approval policy, injection and PII screening of tool results.",
    stack: "TypeScript - Node - MCP",
    tests: "17 tests",
    result: "In the platform drill its screening flagged 6 patterns in one tool result: ignore-instructions, export-all-data, a secret-exfil URL, SSN, email, phone.",
    url: "https://github.com/hsooligan95/agent-gate"
  },
  {
    id: "cred-broker", name: "cred-broker", layer: "Govern",
    one: "Short-lived, tightly scoped credentials for agents: a policy engine approves, denies, or scopes down each request; tokens expire in minutes.",
    stack: "Python - stdlib only - HMAC tokens",
    tests: "18 tests",
    result: "Asked for db/* + write + 3600s; granted db/factory/* + read-only + 300s, with the cut recorded. Leak check: the secret appears 0 times in the full transcript.",
    url: "https://github.com/hsooligan95/cred-broker"
  },
  {
    id: "agent-canary", name: "agent-canary", layer: "Prove",
    one: "CI for agent behavior: shadow-runs a candidate version against the current one over a golden task suite and blocks promotion on regression.",
    stack: "Python - pytest - GitHub Actions",
    tests: "16 tests",
    result: "Blocked the drill's candidate cold: success 100% -> 36% with 10 forbidden actions. Cheaper and faster - and still blocked. Exit code 2 is the gate.",
    url: "https://github.com/hsooligan95/agent-canary"
  },
  {
    id: "agent-chaos", name: "agent-chaos", layer: "Prove",
    one: "Chaos engineering for agents: tool timeouts, hallucinating tools, prompt injection, poisoned results, corrupted context.",
    stack: "Python",
    tests: "17 tests",
    result: "Silent-failure rate across five fault scenarios: 100% with defenses off, 0% with defenses on.",
    url: "https://github.com/hsooligan95/agent-chaos"
  },
  {
    id: "agent-flightsim", name: "agent-flightsim", layer: "Prove",
    one: "Scenario engine sweeping world-state axes - staleness, dependency, user type, redundancy - judged by freshness and consistency oracles.",
    stack: "Python",
    tests: "26 tests",
    result: "Found a failure class nobody had listed: a uniformly stale corpus reported as current, every sentence grounded at 1.0. 72 oracle findings across 108 grid runs.",
    url: "https://github.com/hsooligan95/agent-flightsim"
  },
  {
    id: "rag-evaluation-harness", name: "rag-evaluation-harness", layer: "Prove",
    one: "Labeled evaluation for the retrieval pipeline: per-case diagnosis naming the failing stage, plus a grounding-threshold sweep.",
    stack: "Python - stdlib retrieval",
    tests: "18/18 eval cases",
    result: "18 labeled cases - answerable and must-abstain - pass 18/18, each failure mode attributed to the stage that caused it.",
    url: "https://github.com/hsooligan95/rag-evaluation-harness"
  },
  {
    id: "blast-radius", name: "blast-radius", layer: "Execute",
    one: "Infrastructure remediation agent whose engineering is the execution shell: plan, approve, checkpointed execute, verify, roll back.",
    stack: "Python - LangGraph - moto (mock AWS)",
    tests: "17 tests",
    result: "Killed with kill -9 mid-run, resumed from the checkpoint, verification failed on a bad disk, and it rolled back to a byte-identical state. 46 audit events.",
    url: "https://github.com/hsooligan95/blast-radius"
  },
  {
    id: "mission-control", name: "mission-control", layer: "Execute",
    one: "Multi-agent incident response: specialists hand off A2A-style; an arbiter resolves conflicting proposals by gathering new evidence - never by voting.",
    stack: "Python",
    tests: "14 tests",
    result: "The arbiter chose rollback (confidence 0.6) over scale-out (0.8) because it queried the environment and found the deploy that started the errors. Flipping every confidence changes nothing.",
    url: "https://github.com/hsooligan95/mission-control"
  },
  {
    id: "agent-ledger", name: "agent-ledger", layer: "Meter",
    one: "FinOps for agents: OpenTelemetry cost attribution per agent / run / task / step, budgets that halt runaway runs, and model routing.",
    stack: "Python - OpenTelemetry - SQLite",
    tests: "14 tests",
    result: "Step routing measured 40.5% cheaper at identical outcomes; a runaway loop was halted at step 6 by a $0.25 budget.",
    url: "https://github.com/hsooligan95/agent-ledger"
  },
  {
    id: "agent-trace", name: "agent-trace", layer: "Trace",
    one: "The trace and audit spine: one trace ID follows work across agents into a single hash-chained, tamper-evident event store with decision records.",
    stack: "Python - Rust verifier - stdlib dashboard",
    tests: "60 tests",
    result: "The drill replayed below: 117 events, six producers, one trace ID, chain verified end-to-end. A one-character tamper names its exact seq.",
    url: "https://github.com/hsooligan95/agent-trace"
  },
  {
    id: "agentcore-port", name: "agentcore-port", layer: "Deploy",
    one: "The AWS Bedrock AgentCore deployment pattern, proven locally: the factory-floor agent served behind the AgentCore Runtime HTTP contract.",
    stack: "Python - stdlib HTTP",
    tests: "12 tests",
    result: "In-process and served paths answer identically on 18/18 eval cases. The cloud templates are included and honestly labeled untested against AWS.",
    url: "https://github.com/hsooligan95/agentcore-port"
  },
  {
    id: "pulumi-serverless-stack", name: "pulumi-serverless-stack", layer: "Deploy",
    one: "A serverless API - API Gateway + Lambda + DynamoDB - defined entirely in TypeScript with Pulumi. Infrastructure as real code, no YAML.",
    stack: "TypeScript - Pulumi - AWS",
    tests: "tsc typecheck clean",
    result: "Least-privilege by construction: the function's IAM role can read and write only its own table.",
    url: "https://github.com/hsooligan95/pulumi-serverless-stack"
  },
  {
    id: "ato-in-a-box", name: "ato-in-a-box", layer: "Comply",
    one: "Compliance evidence packs generated from AgentTrace exports: platform controls mapped to NIST 800-53 and the NIST AI RMF, each citing its artifact.",
    stack: "Python",
    tests: "10 tests",
    result: "From the drill store: 13 controls evidenced, 12 gaps declared. No artifact, no claim - a control with no evidence is demoted to the gaps section automatically.",
    url: "https://github.com/hsooligan95/ato-in-a-box"
  }
];
