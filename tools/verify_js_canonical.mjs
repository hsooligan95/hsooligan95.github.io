// Headless proof that the JS canonicalizer + SHA-256 in ../canonical.js
// agree with the Python implementation (agenttrace/store.py):
//  1. every stored hash in the real drill store recomputes identically,
//  2. the full chain verifies OK in JS,
//  3. canonical strings match Python's json.dumps byte-for-byte,
//  4. flipping one character in one event breaks the JS chain at that seq.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../canonical.js");

const storePath = process.argv[2];
const lines = readFileSync(storePath, "utf8").split("\n").filter((l) => l.trim());
const events = lines.map((l) => C.parseJSON(l));

// 1+2: hashes and chain
let hashOk = 0;
for (const ev of events) {
  const body = { t: "obj", entries: ev.entries.filter((e) => e[0] !== "hash") };
  const h = C.sha256Hex(C.canonical(body));
  if (h === C.strVal(C.getField(ev, "hash"))) hashOk++;
}
console.log(`hash agreement: ${hashOk}/${events.length}`);
const res = C.verifyChain(events);
console.log("JS verifyChain:", JSON.stringify(res));

// 3: canonical string equality vs Python
const py = execFileSync("python3", ["-c", `
import json, sys
for line in open(sys.argv[1]):
    if line.strip():
        e = json.loads(line)
        body = {k: v for k, v in e.items() if k != "hash"}
        print(json.dumps(body, sort_keys=True, separators=(",", ":")))
`, storePath], { encoding: "utf8" }).split("\n").filter((l) => l.trim());
let canonOk = 0;
events.forEach((ev, i) => {
  const body = { t: "obj", entries: ev.entries.filter((e) => e[0] !== "hash") };
  if (C.canonical(body) === py[i]) canonOk++;
  else console.log("CANON MISMATCH at seq", i + 1, "\n JS:", C.canonical(body).slice(0, 200), "\n PY:", py[i].slice(0, 200));
});
console.log(`canonical string agreement: ${canonOk}/${events.length}`);

// 4: tamper at seq 6 (flip one character inside a string value)
const tampered = lines.slice();
tampered[5] = tampered[5].replace('"agent-gate"', '"agent-gatx"'); // flip 1 char in a string value
if (tampered[5] === lines[5]) throw new Error("tamper target not found in seq 6 line");
const tRes = C.verifyChain(tampered.map((l) => C.parseJSON(l)));
console.log("tampered (seq 6 content flip) JS verifyChain:", JSON.stringify(tRes));

if (hashOk !== events.length || canonOk !== events.length || !res.ok || tRes.ok || tRes.brokenSeq !== 6) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
