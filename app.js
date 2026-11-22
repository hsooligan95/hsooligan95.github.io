/* Andrew Hsu - developer site. Fleet graph, drill replay, live tamper
 * test, project index. All data is local: data/projects.js (facts),
 * data/drill.js + data/chain.js (generated from the real AgentTrace
 * drill store by tools/gen_data.py). */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const PRODUCERS = new Set(Object.keys(window.DRILL.producerCounts));
  const byId = {};
  window.PROJECTS.forEach((p) => { byId[p.id] = p; });

  /* ================= fleet graph ================= */
  const svg = $("#graph");
  const NS = "http://www.w3.org/2000/svg";
  const CX = 500, CY = 310, RX = 385, RY = 232;
  // order nodes around the ring by platform layer, so the arc reads in order
  const ordered = [];
  window.LAYERS.forEach((l) => window.PROJECTS.filter((p) => p.layer === l).forEach((p) => ordered.push(p)));

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function labelLines(name) {
    if (name.length <= 16) return [name];
    const parts = name.split("-");
    const lines = ["", ""];
    let cur = 0;
    parts.forEach((w, i) => {
      const cand = lines[cur] ? lines[cur] + "-" + w : w;
      if (cand.length > 16 && lines[cur] && cur === 0) { cur = 1; lines[cur] = w; }
      else lines[cur] = cand;
    });
    return lines.filter((l) => l);
  }

  const nodeEls = {};   // id -> <g>
  const edgeEls = {};   // id -> <line>
  const nodePos = {};   // id -> {x, y}
  ordered.forEach((p, i) => {
    const a = (i / ordered.length) * Math.PI * 2 - Math.PI / 2;
    const x = CX + RX * Math.cos(a), y = CY + RY * Math.sin(a);
    edgeEls[p.id] = el("line", { x1: CX, y1: CY, x2: x, y2: y, "class": "edge" }, svg);
  });
  // hub
  const hub = el("g", { "class": "hub" }, svg);
  el("circle", { cx: CX, cy: CY, r: 52 }, hub);
  const ht = el("text", { x: CX, y: CY - 4 }, hub); ht.textContent = "AGENTTRACE";
  const ht2 = el("text", { x: CX, y: CY + 14, "class": "hub-sub" }, hub); ht2.textContent = "trace store";
  const ht3 = el("text", { x: CX, y: CY + 30, "class": "hub-sub", id: "hub-count" }, hub); ht3.textContent = "0 events";

  ordered.forEach((p, i) => {
    const a = (i / ordered.length) * Math.PI * 2 - Math.PI / 2;
    const x = CX + RX * Math.cos(a), y = CY + RY * Math.sin(a);
    nodePos[p.id] = { x: x, y: y };
    const g = el("g", { "class": "node", "data-id": p.id, tabindex: "0", role: "button",
                        "aria-label": p.name }, svg);
    el("circle", { cx: x, cy: y, r: 17, fill: "transparent" }, g); // hit area
    el("circle", { cx: x, cy: y, r: 6.5, "class": "ring" }, g);
    if (PRODUCERS.has(p.id)) el("circle", { cx: x + 11, cy: y - 11, r: 3, "class": "producer-dot" }, g);
    const lines = labelLines(p.name);
    lines.forEach((ln, li) => {
      const t = el("text", { x: x, y: y + 24 + li * 14 }, g);
      t.textContent = ln;
    });
    const sub = el("text", { x: x, y: y + 24 + lines.length * 14, "class": "sub" }, g);
    sub.textContent = p.layer.toUpperCase();
    g.addEventListener("click", () => selectProject(p.id, false));
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectProject(p.id, false); } });
    nodeEls[p.id] = g;
  });

  /* walkthrough state (the engine lives below the graph code) */
  let tourActive = false, tourStep = -1, tourRaf = null;
  let tourFx = [];   // svg elements owned by the current tour step

  const panel = $("#node-panel");
  let selected = null;
  function selectProject(id, scroll) {
    if (tourActive) exitTour();
    selected = id;
    Object.entries(nodeEls).forEach(([k, g]) => g.classList.toggle("selected", k === id));
    const p = byId[id];
    panel.classList.remove("touring");
    panel.innerHTML =
      '<span class="np-layer">' + p.layer + " layer</span>" +
      '<span class="np-provider">' + p.provider + "</span>" +
      "<h3>" + p.name + "</h3>" +
      '<div class="np-sec"><b>PURPOSE</b><p>' + p.purpose + "</p></div>" +
      '<div class="np-sec"><b>WHAT MAKES IT UNIQUE</b><p>' + p.unique + "</p></div>" +
      '<p class="np-io"><span>consumes</span>' + p.consumes + "</p>" +
      '<p class="np-io"><span>produces</span>' + p.produces + "</p>" +
      '<div class="np-sec"><b>TALKS TO</b><div class="talk-chips">' +
        p.talks.map((t) => '<button type="button" class="talk-chip" data-talk="' + t + '">' + t + "</button>").join("") +
      "</div></div>" +
      '<p class="np-row">stack&nbsp;&nbsp;<b>' + p.stack + "</b></p>" +
      '<p class="np-row">proof&nbsp;&nbsp;<b>' + p.tests + "</b></p>" +
      '<div class="np-result"><b>VERIFIED RESULT</b>' + p.result + "</div>" +
      '<a class="np-link" href="' + p.url + '">github.com/hsooligan95/' + p.name + " -></a>";
    panel.querySelectorAll(".talk-chip").forEach((chip) =>
      chip.addEventListener("click", () => selectProject(chip.dataset.talk, false)));
    if (scroll) $("#fleet").scrollIntoView({ behavior: "smooth" });
  }
  selectProject("agent-trace", false);

  /* ================= guided walkthrough =================
   * A stepped tour over the fleet graph: each step highlights the
   * nodes involved, animates what flows between them, and captions
   * it in plain language. Every caption traces to a repo README or a
   * recorded artifact (the drill store, the broker demo transcript,
   * the arbitration report) - the steps follow the real flow of
   * work through the platform. */
  const TOUR = [
    { nodes: ["factory-floor-agent"], uniq: "factory-floor-agent",
      title: "The working agent",
      body: "factory-floor-agent answers questions the LangGraph way: plan, retrieve, answer - then check its own answer against the retrieved passages. If the evidence isn't there, it abstains instead of guessing.",
      flow: "A question in -> a cited answer (or an abstention) out" },
    { nodes: ["agent-canary"], uniq: "agent-canary",
      title: "Gated before it runs",
      body: "Before a new version of that agent may run at all, agent-canary shadow-runs it against the current version over a golden task suite, scored by programmatic checks - no LLM judge. In the recorded drill it blocked the candidate cold: success fell 100% -> 36% with 10 forbidden actions, and exit code 2 stopped the promotion.",
      flow: "A candidate config -> a PROMOTE or BLOCK verdict (a decision record)" },
    { nodes: ["cred-broker", "agent-gate"], arc: ["cred-broker", "agent-gate"], uniq: "cred-broker",
      title: "Credentials, scoped down",
      body: "When the agent needs access, it doesn't hold a long-lived key. cred-broker's policy engine approves, denies, or scopes the request down - in its demo, db/* + write + 3600s came back as db/factory/* + read-only + 300s - and agent-gate verifies that token on the calls that follow.",
      flow: "An access request -> a short-lived, scoped credential" },
    { nodes: ["agent-gate"], uniq: "agent-gate",
      title: "Policy at the door",
      body: "Every tool call passes through agent-gate: per-agent allowlists, allow / deny / require-approval policy, and screening of tool results before the agent sees them. In the drill it flagged 6 patterns in a single result - an ignore-instructions injection, an export-all-data request, a secret-exfil URL, an SSN, an email, a phone number.",
      flow: "Tool calls and results -> allow / deny / approval decisions" },
    { nodes: ["blast-radius"], uniq: "blast-radius",
      title: "Execution with a way back",
      body: "Approved changes run inside blast-radius's execution shell: a deterministic plan, explicit human approval, then one checkpointed step at a time. In the drill the process was killed with kill -9 mid-run; a fresh process resumed from the checkpoint, verification failed on a bad disk, and rollback restored a byte-identical state.",
      flow: "An approved plan -> executed steps, checkpoints, and - when needed - a rollback" },
    { nodes: ["agent-ledger"], uniq: "agent-ledger",
      title: "Every step metered",
      body: "agent-ledger meters every step as an OpenTelemetry span, cost attributed per agent, run, task, and step. Budgets bite mid-flight: a runaway loop was halted at step 6 by a $0.25 budget, and step routing measured 40.5% cheaper at identical outcomes.",
      flow: "Steps -> cost spans and a running total ($0.57313 for the whole drill)" },
    { nodes: ["agent-trace"], hub: true, uniq: "agent-trace",
      title: "One record of everything",
      body: "Everything you just saw emitted into one store under a single trace ID - which is why this graph is drawn the way it is: the spokes are producers, the center is agent-trace. The store is append-only and hash-chained, so the record verifies end-to-end and a one-character tamper names its exact event.",
      flow: "Events from every producer -> one verifiable timeline (117 events in the drill)" },
    { nodes: ["agent-chaos", "agent-flightsim"], uniq: "agent-flightsim",
      title: "Proven before production",
      body: "Before any of this is trusted, the Prove layer attacks it. agent-chaos injects tool failures, prompt injection, and poisoned results - silent failures went from 100% with defenses off to 0% with them on. agent-flightsim sweeps world states and caught an agent fluently reporting a stale corpus as current, every sentence grounded at 1.0.",
      flow: "Faults and hostile worlds -> measured failure rates and oracle findings" },
    { nodes: ["mission-control"], uniq: "mission-control",
      title: "Disagreement, arbitrated",
      body: "When specialist agents disagree on an incident, mission-control doesn't vote and never weighs their confidences. Its arbiter gathers new evidence from the environment and decides from that alone - in the recorded run it chose rollback (confidence 0.6) over scale-out (0.8), because it found the deploy that started the errors.",
      flow: "Conflicting proposals -> an evidence-cited decision record" },
    { nodes: ["ato-in-a-box"], uniq: "ato-in-a-box",
      title: "Evidence for the assessor",
      body: "Finally, ato-in-a-box turns the trace record into a compliance evidence pack: controls mapped to NIST 800-53 and the AI RMF, each citing concrete event numbers. From the drill store: 13 controls evidenced - and 12 gaps declared, because a control with no artifact behind it is demoted automatically.",
      flow: "The trace store -> an assessor-ready evidence pack" },
    { nodes: ordered.map((p) => p.id), hub: true, scale: true, uniq: null,
      title: "How it scales",
      body: "One agent or a hundred run on the same spine: allowlists, budgets, and credentials are per-agent, the store stays append-only, and the trace ID discipline doesn't change. The whole flow is re-proven nightly - agent-trace's CI re-runs this drill on fresh checkouts and commits the verified status back.",
      flow: "The same platform, at fleet size",
      link: { href: "https://github.com/hsooligan95/agent-trace/actions/workflows/nightly-drill.yml", text: "See the nightly drill runs ->" } },
  ];

  const tourBtn = $("#tour-btn");
  function clearTourFx() {
    if (tourRaf) { cancelAnimationFrame(tourRaf); tourRaf = null; }
    tourFx.forEach((e) => e.remove()); tourFx = [];
    Object.values(nodeEls).forEach((g) => g.classList.remove("dim", "tour-hot"));
    Object.values(edgeEls).forEach((e) => e.classList.remove("hot"));
    hub.classList.remove("tour-hot");
    svg.classList.remove("touring");
  }
  function exitTour() {
    const was = tourActive;
    tourActive = false; tourStep = -1;
    clearTourFx();
    tourBtn.textContent = "Walk me through it";
    if (was && selected) selectProject(selected, false);
  }
  function tourSegments(step) {
    const segs = [];
    if (step.arc) {
      const a = nodePos[step.arc[0]], b = nodePos[step.arc[1]];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cxp = CX + (mx - CX) * 0.7, cyp = CY + (my - CY) * 0.7;
      const path = el("path", { d: "M " + a.x + " " + a.y + " Q " + cxp + " " + cyp + " " + b.x + " " + b.y,
                                "class": "tour-arc" }, svg);
      tourFx.push(path);
      segs.push({ path: path, trim: 1 });
    } else {
      step.nodes.forEach((id) => {
        const p = nodePos[id];
        const path = el("path", { d: "M " + p.x + " " + p.y + " L " + CX + " " + CY,
                                  "class": "tour-spoke" }, svg);
        tourFx.push(path);
        segs.push({ path: path, trim: 0.86 });
      });
    }
    return segs;
  }
  function runTourAnimation(segs) {
    const dots = segs.map(() => {
      const c = el("circle", { r: 4, "class": "tour-pulse" }, svg);
      tourFx.push(c);
      return c;
    });
    const DUR = 1100, CYCLE = 1650, t0 = performance.now();
    function frame(now) {
      if (!tourActive) return;
      segs.forEach((s, i) => {
        const t = ((now - t0 + i * 160) % CYCLE) / DUR;
        if (t > 1) { dots[i].setAttribute("opacity", "0"); return; }
        const pt = s.path.getPointAtLength(t * s.trim * s.path.getTotalLength());
        dots[i].setAttribute("cx", pt.x);
        dots[i].setAttribute("cy", pt.y);
        dots[i].setAttribute("opacity", (t < 0.05 || t > 0.97) ? "0.3" : "1");
      });
      tourRaf = requestAnimationFrame(frame);
    }
    tourRaf = requestAnimationFrame(frame);
  }
  function showTourStep(i) {
    clearTourFx();
    tourStep = i;
    const step = TOUR[i];
    svg.classList.add("touring");
    Object.entries(nodeEls).forEach(([id, g]) => {
      g.classList.toggle("dim", !step.nodes.includes(id));
      g.classList.toggle("tour-hot", step.nodes.includes(id));
    });
    step.nodes.forEach((id) => { if (edgeEls[id]) edgeEls[id].classList.add("hot"); });
    if (step.hub) hub.classList.add("tour-hot");
    runTourAnimation(tourSegments(step));
    panel.classList.add("touring");
    panel.innerHTML =
      '<span class="np-layer">Walkthrough - step ' + (i + 1) + " of " + TOUR.length + "</span>" +
      "<h3>" + step.title + "</h3>" +
      '<p class="np-tour-body">' + step.body + "</p>" +
      '<p class="np-io"><span>flowed</span>' + step.flow + "</p>" +
      (step.uniq ? '<div class="np-sec"><b>WHAT MAKES IT UNIQUE</b><p>' + byId[step.uniq].unique + "</p></div>" : "") +
      (step.link ? '<a class="np-link" href="' + step.link.href + '">' + step.link.text + "</a>" : "") +
      '<div class="tour-controls">' +
        '<button type="button" class="btn-ghost" id="tour-prev"' + (i === 0 ? " disabled" : "") + ">Prev</button>" +
        '<div class="tour-dots">' + TOUR.map((_, d) =>
          '<button type="button" class="tour-dot' + (d === i ? " on" : "") + '" data-step="' + d +
          '" aria-label="Step ' + (d + 1) + '"></button>').join("") + "</div>" +
        '<button type="button" class="btn-amber" id="tour-next">' +
          (i === TOUR.length - 1 ? "Finish" : "Next") + "</button>" +
      "</div>" +
      '<button type="button" class="tour-exit" id="tour-exit">Exit walkthrough (Esc)</button>';
    panel.querySelector("#tour-prev").addEventListener("click", () => { if (tourStep > 0) showTourStep(tourStep - 1); });
    panel.querySelector("#tour-next").addEventListener("click", () => {
      if (tourStep >= TOUR.length - 1) exitTour(); else showTourStep(tourStep + 1);
    });
    panel.querySelector("#tour-exit").addEventListener("click", exitTour);
    panel.querySelectorAll(".tour-dot").forEach((d) =>
      d.addEventListener("click", () => showTourStep(parseInt(d.dataset.step, 10))));
  }
  function startTour() {
    tourActive = true;
    Object.values(nodeEls).forEach((g) => g.classList.remove("selected"));
    tourBtn.textContent = "Exit walkthrough";
    showTourStep(0);
    $("#fleet").scrollIntoView({ behavior: "smooth" });
  }
  tourBtn.addEventListener("click", () => { tourActive ? exitTour() : startTour(); });
  document.addEventListener("keydown", (ev) => {
    if (!tourActive) return;
    if (ev.key === "Escape") exitTour();
    if (ev.key === "ArrowRight" && tourStep < TOUR.length - 1) showTourStep(tourStep + 1);
    if (ev.key === "ArrowLeft" && tourStep > 0) showTourStep(tourStep - 1);
  });

  /* ================= agent ops feed (recorded replay) =================
   * Three recorded runs, replayed as a group-chat feed. Scripts are
   * generated (tools/gen_feed.py): channel 1 from the real AgentTrace
   * drill store, channel 2 from the MissionControl suite report,
   * channel 3 from the AgentFlightSim shipped run. */
  const feedEl = $("#feed"), rosterEl = $("#roster-list"), decEl = $("#decisions");
  const feedPlayBtn = $("#play-btn"), feedStatus = $("#feed-status"), feedBar = $("#feed-bar");
  let chan = null, chanIdx = 0, itemIdx = 0, playing = false, userHold = false;
  let finished = false, speed = 1, feedTimer = null, typingEl = null;
  let chanPace = 1; // per-channel slowdown on top of the base delays
  let rosterEls = {};

  function rosterSet(id, state, text) {
    const r = rosterEls[id];
    if (!r) return;
    r.dot.className = "r-dot " + state;
    if (text) r.status.textContent = text;
  }
  function buildChannel(ci) {
    clearTimeout(feedTimer);
    hideTyping();
    playing = false; userHold = false; finished = false; itemIdx = 0;
    chanIdx = ci; chan = window.FEED.channels[ci];
    // The arbitration is a deliberation, not a drill: it runs slower.
    // The FlightSim batch is a post-mortem: slightly slower than the drill.
    chanPace = chan.id === "incident-arbitration" ? 1.5
             : chan.id === "flightsim" ? 1.25 : 1;
    feedEl.innerHTML = ""; decEl.innerHTML = ""; rosterEl.innerHTML = "";
    rosterEls = {};
    chan.roster.forEach((r) => {
      const row = document.createElement("div");
      row.className = "roster-row";
      row.innerHTML = '<span class="r-dot idle"></span><span class="r-main">' +
        '<span class="r-name">' + r.id + '</span>' +
        '<span class="r-note">' + r.note + '</span>' +
        '<span class="r-status">idle</span></span>';
      rosterEl.appendChild(row);
      rosterEls[r.id] = { dot: row.querySelector(".r-dot"), status: row.querySelector(".r-status") };
    });
    $("#feed-heading").textContent = chan.heading;
    $("#st-events").textContent = "0 / " + chan.totals.events;
    $("#st-cost-row").style.display = chan.totals.cost == null ? "none" : "";
    $("#st-cost").textContent = "$0.00000";
    $("#st-chain").textContent = "VERIFIED";
    if (chan.id === "platform-drill") $("#hub-count").textContent = "0 events";
    feedBar.style.width = "0%";
    feedPlayBtn.textContent = "Play";
    feedStatus.textContent = "ready — " + chan.items.length + " posts";
    document.querySelectorAll(".chan-tab").forEach((t, i) =>
      t.classList.toggle("active", i === ci));
  }
  function showTyping(it) {
    hideTyping();
    typingEl = document.createElement("div");
    typingEl.className = "fm fm-typing";
    typingEl.innerHTML = '<span class="fm-agent">' + it.agent + '</span>' +
      '<span class="t-text">' + (it.say || "is working") + '</span>' +
      '<span class="t-dots"><i></i><i></i><i></i></span>';
    feedEl.appendChild(typingEl);
    feedEl.scrollTop = feedEl.scrollHeight;
    rosterSet(it.agent, "speaking", it.say || "working");
    pulseNode(it.agent);
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }
  function pulseNode(id) {
    const g = nodeEls[id];
    if (!g) return;
    g.classList.remove("pulse"); void g.offsetWidth; g.classList.add("pulse");
    setTimeout(() => g.classList.remove("pulse"), 950);
  }
  function land(it) {
    const el = document.createElement("div");
    if (it.kind === "msg") {
      el.className = "fm fm-msg";
      el.innerHTML = '<div class="fm-head"><span class="fm-agent">' + it.agent +
        '</span><span class="fm-seq">' + (chan.seqword || "store @ seq ") + it.ev + '</span></div>' +
        '<div class="fm-body">' + it.text + '</div>';
      rosterSet(it.agent, "idle", "last post · " + (chan.seqword ? "post " : "seq ") + it.ev);
    } else if (it.kind === "decision") {
      el.className = "fm fm-decision" + (it.tone ? " fm-" + it.tone : "");
      el.innerHTML = '<div class="fm-head"><span class="fm-agent">' + it.agent +
        '</span><span class="fm-dec-tag">DECISION</span>' +
        '<span class="fm-seq">' + (chan.seqword || "store @ seq ") + it.ev + '</span></div>' +
        '<div class="fm-title">' + it.title + '</div><ul class="fm-lines">' +
        it.lines.map((l) => "<li>" + l + "</li>").join("") + "</ul>";
      const row = document.createElement("div");
      row.className = "dec-row"; row.textContent = it.log;
      decEl.appendChild(row);
      rosterSet(it.agent, "idle", "decision recorded · " + (chan.seqword ? "post " : "seq ") + it.ev);
    } else {
      el.className = "fm fm-sys sys-" + it.style;
      el.textContent = it.text;
    }
    if (it.status) Object.entries(it.status).forEach(([id, [st, tx]]) => {
      rosterSet(id, st, tx); pulseNode(id);
    });
    feedEl.appendChild(el);
    feedEl.scrollTop = feedEl.scrollHeight;
    $("#st-events").textContent = it.ev + " / " + chan.totals.events;
    if (chan.totals.cost != null && it.cost != null)
      $("#st-cost").textContent = "$" + it.cost.toFixed(5);
    if (chan.id === "platform-drill") $("#hub-count").textContent = it.ev + " events";
    feedBar.style.width = Math.round((itemIdx + 1) / chan.items.length * 100) + "%";
  }
  /* Pacing at 1x (before the per-channel pace and the speed control):
   * the typing dwell scales with how much the agent is "saying", so a
   * substantive post gets a beat of visible thinking (~0.95-1.5s);
   * decisions and system banners then hold ~1.7s so they can land.
   * Channel 1 lands at ~90s total, channel 2 (at 1.5x pace) at ~40s. */
  function delays(it) {
    if (it.kind === "decision") return { pre: 1400, hold: 1700 };
    if (it.kind === "system") return { pre: 500, hold: 1700 };
    const len = (it.text || "").length;
    const type = Math.min(1500, Math.max(950, 700 + len * 4));
    return { pre: type, hold: 950 };
  }
  function step() {
    if (!playing) return;
    if (itemIdx >= chan.items.length) {
      finished = true; playing = false;
      feedPlayBtn.textContent = "Replay";
      feedStatus.textContent = "complete — " + chan.items.length + " posts, all decisions on record";
      Object.keys(rosterEls).forEach((id) => {
        if (rosterEls[id].dot.className.indexOf("dead") < 0) rosterSet(id, "done", "done");
      });
      return;
    }
    const it = chan.items[itemIdx];
    const d = delays(it);
    const slow = chanPace / speed; // timeouts scale up with pace, down with speed
    if (it.agent) {
      showTyping(it);
      feedTimer = setTimeout(() => {
        hideTyping(); land(it); itemIdx++;
        feedTimer = setTimeout(step, d.hold * slow);
      }, d.pre * slow);
    } else {
      feedTimer = setTimeout(() => {
        land(it); itemIdx++;
        feedTimer = setTimeout(step, d.hold * slow);
      }, d.pre * slow);
    }
  }
  function playFeed() {
    if (finished) buildChannel(chanIdx);
    if (playing) return;
    playing = true; userHold = false;
    feedPlayBtn.textContent = "Pause";
    feedStatus.textContent = "replaying — recorded run";
    step();
  }
  function pauseFeed(auto) {
    if (!playing) return;
    playing = false;
    clearTimeout(feedTimer); hideTyping();
    if (!auto) userHold = true;
    feedPlayBtn.textContent = finished ? "Replay" : "Play";
    feedStatus.textContent = "paused";
  }
  feedPlayBtn.addEventListener("click", () => { playing ? pauseFeed(false) : playFeed(); });
  $("#restart-btn").addEventListener("click", () => { buildChannel(chanIdx); playFeed(); });
  document.querySelectorAll(".speed-btn").forEach((b) => b.addEventListener("click", () => {
    speed = parseInt(b.dataset.speed, 10);
    document.querySelectorAll(".speed-btn").forEach((x) => x.classList.toggle("active", x === b));
  }));
  document.querySelectorAll(".chan-tab").forEach((t) => t.addEventListener("click", () => {
    buildChannel(parseInt(t.dataset.chan, 10)); playFeed();
  }));
  buildChannel(0);
  const feedIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { if (!userHold && !finished) playFeed(); }
      else pauseFeed(true);
    });
  }, { threshold: 0.2 });
  feedIO.observe($("#run"));

  /* ================= tamper demo ================= */
  const C = window.AgentTraceCanon;
  let working = window.CHAIN_EVENTS.slice();   // raw JSON text per event
  let cur = 0;
  const listEl = $("#chain-list"), editor = $("#event-editor"), statusEl = $("#tamper-status");

  function metaOf(raw) {
    try {
      const o = JSON.parse(raw);
      return { seq: o.seq, source: o.source, type: o.type, hash: o.hash };
    } catch (e) { return { seq: "?", source: "(invalid JSON)", type: "", hash: "" }; }
  }
  function renderChainList(marks) {
    listEl.innerHTML = "";
    working.forEach((raw, i) => {
      const m = metaOf(raw);
      const row = document.createElement("div");
      row.className = "chain-row" + (i === cur ? " selected" : "");
      let mark = "";
      if (marks && marks[i] === "ok") mark = '<span class="cr-mark ok">hash ok</span>';
      if (marks && marks[i] === "bad") mark = '<span class="cr-mark bad">BROKEN</span>';
      row.innerHTML = '<span class="cr-seq">seq ' + m.seq + "</span><span>" +
        m.source + " - " + m.type + '</span><span class="cr-hash">' +
        (m.hash ? m.hash.slice(0, 10) + "…" : "") + "</span>" + mark;
      row.addEventListener("click", () => { saveEditor(); cur = i; loadEditor(); renderChainList(marks); });
      listEl.appendChild(row);
    });
  }
  function loadEditor() {
    let prettyText;
    try { prettyText = C.pretty(C.parseJSON(working[cur])); }
    catch (e) { prettyText = working[cur]; }
    editor.value = prettyText;
    $("#editor-seq").textContent = "seq " + (cur + 1);
  }
  function saveEditor() { working[cur] = editor.value; }

  function runVerify() {
    saveEditor();
    let parsed;
    try { parsed = working.map((t) => C.parseJSON(t)); }
    catch (e) {
      statusEl.className = "tamper-status bad mono";
      statusEl.textContent = "INVALID JSON - " + e.message;
      renderChainList(null);
      return;
    }
    const res = C.verifyChain(parsed);
    const marks = {};
    parsed.forEach((_, i) => { marks[i] = "ok"; });
    if (res.ok) {
      statusEl.className = "tamper-status ok mono";
      statusEl.textContent = "CHAIN VERIFIED - " + res.count + " events, every hash verified. " +
        "(These are seqs 1-" + res.count + " of the full " + window.CHAIN_FULL_COUNT + "-event drill store.)";
    } else {
      marks[res.brokenSeq - 1] = "bad";
      for (let i = res.brokenSeq; i < parsed.length; i++) delete marks[i];
      statusEl.className = "tamper-status bad mono";
      statusEl.textContent = "CHAIN BROKEN @ SEQ " + res.brokenSeq + " - " + res.detail + ".";
    }
    renderChainList(marks);
  }
  $("#verify-btn").addEventListener("click", runVerify);
  $("#flip-btn").addEventListener("click", () => {
    saveEditor();
    let t = working[cur];
    // flip one letter inside the first string value after "type":
    const m = t.match(/"type":\s*"[A-Za-z]/);
    if (m) {
      const at = m.index + m[0].length - 1;
      const ch = t[at] === "x" ? "q" : "x";
      t = t.slice(0, at) + ch + t.slice(at + 1);
    } else {
      t = t.replace(/[a-z]/, "x");
    }
    working[cur] = t;
    loadEditor();
    runVerify();
  });
  $("#reset-btn").addEventListener("click", () => {
    working = window.CHAIN_EVENTS.slice();
    loadEditor();
    runVerify();
  });
  loadEditor();
  runVerify(); // prove the untouched chain verifies, live, on load

  /* ================= project index ================= */
  const idx = $("#project-index");
  window.LAYERS.forEach((layer) => {
    const block = document.createElement("div");
    block.className = "layer-block";
    const h = document.createElement("div");
    h.className = "layer-name"; h.textContent = layer;
    block.appendChild(h);
    window.PROJECTS.filter((p) => p.layer === layer).forEach((p) => {
      const row = document.createElement("div");
      row.className = "proj-row";
      row.innerHTML = '<span class="pr-name">' + p.name + '</span>' +
        '<span class="pr-one">' + p.one + '</span>' +
        '<span class="pr-meta">' + p.stack + "<br>" + p.tests +
        '<br><span class="pr-prov">' + p.provider + "</span></span>";
      row.addEventListener("click", () => selectProject(p.id, true));
      block.appendChild(row);
    });
    idx.appendChild(block);
  });
})();
