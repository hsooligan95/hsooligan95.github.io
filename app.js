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

  const panel = $("#node-panel");
  let selected = null;
  function selectProject(id, scroll) {
    selected = id;
    Object.entries(nodeEls).forEach(([k, g]) => g.classList.toggle("selected", k === id));
    const p = byId[id];
    panel.innerHTML =
      '<span class="np-layer">' + p.layer + " layer</span>" +
      "<h3>" + p.name + "</h3>" +
      '<p class="np-one">' + p.one + "</p>" +
      '<p class="np-row">stack&nbsp;&nbsp;<b>' + p.stack + "</b></p>" +
      '<p class="np-row">proof&nbsp;&nbsp;<b>' + p.tests + "</b></p>" +
      '<div class="np-result"><b>VERIFIED RESULT</b>' + p.result + "</div>" +
      '<a class="np-link" href="' + p.url + '">github.com/hsooligan95/' + p.name + " -></a>";
    if (scroll) $("#fleet").scrollIntoView({ behavior: "smooth" });
  }
  selectProject("agent-trace", false);

  /* ================= drill replay ================= */
  const D = window.DRILL;
  const prefixCost = [0];
  D.events.forEach((e) => prefixCost.push(prefixCost[prefixCost.length - 1] + e.cost));
  const ribbon = $("#ribbon");
  const beatEls = D.beats.map((b) => {
    const d = document.createElement("span");
    d.className = "beat"; d.textContent = b.label; d.title = "seq " + b.atSeq;
    ribbon.appendChild(d);
    return d;
  });
  const scrub = $("#scrub");
  scrub.max = D.totalEvents;
  let pos = 0, timer = null;
  const playBtn = $("#play-btn");

  function renderReplay() {
    $("#stat-events").textContent = pos + " / " + D.totalEvents;
    $("#stat-cost").textContent = "$" + prefixCost[pos].toFixed(5);
    $("#hub-count").textContent = pos + " events";
    D.beats.forEach((b, i) => {
      beatEls[i].classList.toggle("lit", b.atSeq <= pos);
      beatEls[i].classList.remove("frontier");
    });
    const litIdx = D.beats.reduce((acc, b, i) => (b.atSeq <= pos ? i : acc), -1);
    if (litIdx >= 0 && pos < D.totalEvents) beatEls[litIdx].classList.add("frontier");
    // node states
    const fired = {};
    let currentSrc = null;
    for (let i = 0; i < pos; i++) { fired[D.events[i].src] = true; currentSrc = D.events[i].src; }
    Object.entries(nodeEls).forEach(([id, g]) => {
      g.classList.toggle("active", id === currentSrc);
      g.classList.toggle("dim", pos > 0 && PRODUCERS.has(id) && !fired[id]);
      if (edgeEls[id]) edgeEls[id].classList.toggle("hot", !!fired[id]);
    });
    const now = $("#now-event");
    if (pos === 0) now.textContent = "Press play, or drag the scrubber.";
    else {
      const e = D.events[pos - 1];
      now.innerHTML = "seq <b>" + e.seq + "</b> - " + e.src + " - " + e.label;
    }
    scrub.value = pos;
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; playBtn.textContent = pos >= D.totalEvents ? "Replay" : "Play"; } }
  playBtn.addEventListener("click", () => {
    if (timer) { stopTimer(); return; }
    if (pos >= D.totalEvents) pos = 0;
    playBtn.textContent = "Pause";
    timer = setInterval(() => {
      pos++;
      renderReplay();
      if (pos >= D.totalEvents) stopTimer();
    }, 110);
  });
  scrub.addEventListener("input", () => { stopTimer(); pos = parseInt(scrub.value, 10); renderReplay(); });
  renderReplay();

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
        '<span class="pr-meta">' + p.stack + "<br>" + p.tests + "</span>";
      row.addEventListener("click", () => selectProject(p.id, true));
      block.appendChild(row);
    });
    idx.appendChild(block);
  });
})();
