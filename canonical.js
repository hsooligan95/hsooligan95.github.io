/* AgentTrace canonical JSON + SHA-256, ported to JS.
 *
 * The Python reference (agenttrace/store.py) hashes each event as
 *   sha256( json.dumps(event_without_hash, sort_keys=True,
 *                      separators=(",", ":")) )
 * with Python's default ensure_ascii=True escaping. This file reproduces
 * that byte-for-byte in the browser:
 *   - a JSON parser that preserves number literals (so the float 1.0
 *     stays a float and does not collapse to the int 1),
 *   - a canonical serializer matching Python's escaping and float repr,
 *   - a self-contained SHA-256 (no Web Crypto dependency, so the exact
 *     code tested in Node is the code that runs on the page).
 */
(function (global) {
  "use strict";

  /* ---------------- JSON parser preserving number literals -------- */
  function parseJSON(text) {
    let i = 0;
    const n = text.length;
    function err(msg) { throw new Error("JSON parse error at " + i + ": " + msg); }
    function ws() { while (i < n && " \t\n\r".indexOf(text[i]) >= 0) i++; }
    function parseValue() {
      ws();
      if (i >= n) err("unexpected end");
      const c = text[i];
      if (c === "{") return parseObject();
      if (c === "[") return parseArray();
      if (c === '"') return { t: "str", v: parseString() };
      if (c === "t") { expect("true"); return { t: "lit", v: "true" }; }
      if (c === "f") { expect("false"); return { t: "lit", v: "false" }; }
      if (c === "n") { expect("null"); return { t: "lit", v: "null" }; }
      return parseNumber();
    }
    function expect(word) {
      if (text.substr(i, word.length) !== word) err("expected " + word);
      i += word.length;
    }
    function parseString() {
      i++; // opening quote
      let out = "";
      while (i < n) {
        const c = text[i];
        if (c === '"') { i++; return out; }
        if (c === "\\") {
          const e = text[i + 1];
          if (e === "u") {
            out += String.fromCharCode(parseInt(text.substr(i + 2, 4), 16));
            i += 6;
          } else {
            const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
            if (!(e in map)) err("bad escape");
            out += map[e];
            i += 2;
          }
        } else { out += c; i++; }
      }
      err("unterminated string");
    }
    function parseNumber() {
      const start = i;
      if (text[i] === "-") i++;
      while (i < n && /[0-9]/.test(text[i])) i++;
      let isFloat = false;
      if (text[i] === ".") { isFloat = true; i++; while (i < n && /[0-9]/.test(text[i])) i++; }
      if (text[i] === "e" || text[i] === "E") {
        isFloat = true; i++;
        if (text[i] === "+" || text[i] === "-") i++;
        while (i < n && /[0-9]/.test(text[i])) i++;
      }
      if (i === start) err("bad number");
      return { t: "num", lit: text.slice(start, i), isFloat: isFloat };
    }
    function parseArray() {
      i++; const items = [];
      ws(); if (text[i] === "]") { i++; return { t: "arr", items: items }; }
      for (;;) {
        items.push(parseValue());
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return { t: "arr", items: items }; }
        err("expected , or ]");
      }
    }
    function parseObject() {
      i++; const entries = [];
      ws(); if (text[i] === "}") { i++; return { t: "obj", entries: entries }; }
      for (;;) {
        ws();
        if (text[i] !== '"') err("expected object key");
        const key = parseString();
        ws();
        if (text[i] !== ":") err("expected :");
        i++;
        entries.push([key, parseValue()]);
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return { t: "obj", entries: entries }; }
        err("expected , or }");
      }
    }
    const v = parseValue();
    ws();
    if (i !== n) err("trailing characters");
    return v;
  }

  /* ---------------- Python-compatible canonical form -------------- */
  function escapeString(s) {
    let out = '"';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (cp >= 0x20 && cp <= 0x7e) out += ch;
      else if (cp <= 0xffff) out += "\\u" + cp.toString(16).padStart(4, "0");
      else {
        const v = cp - 0x10000;
        out += "\\u" + (0xd800 + (v >> 10)).toString(16).padStart(4, "0");
        out += "\\u" + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
      }
    }
    return out + '"';
  }

  /* Python float repr: shortest round-trip digits; fixed notation for
   * 1e-4 <= |x| < 1e16, scientific (2-digit exponent) outside; integer
   * valued floats keep a trailing .0 */
  function pyFloat(lit) {
    const x = Number(lit);
    if (x === 0) return lit.charAt(0) === "-" ? "-0.0" : "0.0";
    const ax = Math.abs(x);
    if (ax >= 1e-4 && ax < 1e16) {
      let s = String(x); // shortest digits, fixed notation in this range
      if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) {
        s = x.toFixed(20).replace(/0+$/, "").replace(/\.$/, ".0");
      }
      if (s.indexOf(".") < 0) s += ".0";
      return s;
    }
    // scientific: JS gives e.g. 1e-7 / 1.5e+21; Python: 1e-07 / 1.5e+21
    let s = String(x);
    if (s.indexOf("e") < 0) s = x.toExponential();
    const parts = s.split("e");
    let mant = parts[0];
    let exp = parseInt(parts[1], 10);
    if (mant.indexOf(".") < 0) mant += ".0";
    return mant + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  }

  function canonical(v) {
    switch (v.t) {
      case "lit": return v.v;
      case "str": return escapeString(v.v);
      case "num":
        if (v.isFloat) return pyFloat(v.lit);
        return v.lit === "-0" ? "0" : v.lit;
      case "arr": return "[" + v.items.map(canonical).join(",") + "]";
      case "obj": {
        const entries = v.entries.slice().sort(function (a, b) {
          return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        });
        return "{" + entries.map(function (e) {
          return escapeString(e[0]) + ":" + canonical(e[1]);
        }).join(",") + "}";
      }
    }
    throw new Error("bad node");
  }

  /* Pretty printer that preserves number literals verbatim (so an
   * untouched event re-canonicalizes to its original bytes). */
  function pretty(v, indent) {
    indent = indent || 0;
    const pad = "  ".repeat(indent), padIn = "  ".repeat(indent + 1);
    switch (v.t) {
      case "lit": return v.v;
      case "str": return escapeString(v.v);
      case "num": return v.lit;
      case "arr":
        if (!v.items.length) return "[]";
        return "[\n" + v.items.map(function (x) { return padIn + pretty(x, indent + 1); }).join(",\n") + "\n" + pad + "]";
      case "obj":
        if (!v.entries.length) return "{}";
        return "{\n" + v.entries.map(function (e) {
          return padIn + escapeString(e[0]) + ": " + pretty(e[1], indent + 1);
        }).join(",\n") + "\n" + pad + "}";
    }
  }

  /* ---------------- SHA-256 (self-contained) ---------------------- */
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function sha256Hex(ascii) {
    // input is canonical JSON: pure ASCII after escaping
    const bytes = [];
    for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64-bit length; our inputs are < 2^32 bits
    bytes.push(0, 0, 0, 0);
    bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (let block = 0; block < bytes.length; block += 64) {
      for (let t = 0; t < 16; t++) {
        w[t] = (bytes[block + t * 4] << 24) | (bytes[block + t * 4 + 1] << 16) |
               (bytes[block + t * 4 + 2] << 8) | bytes[block + t * 4 + 3];
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (x) {
      return ("00000000" + (x >>> 0).toString(16)).slice(-8);
    }).join("");
  }

  /* ---------------- chain verification ---------------------------- */
  const GENESIS = "0".repeat(64);
  function getField(objNode, key) {
    for (const e of objNode.entries) if (e[0] === key) return e[1];
    return null;
  }
  function strVal(node) { return node && node.t === "str" ? node.v : null; }
  function intVal(node) { return node && node.t === "num" ? parseInt(node.lit, 10) : null; }

  function eventHash(nodeWithoutHash) { return sha256Hex(canonical(nodeWithoutHash)); }

  function withoutHash(objNode) {
    return { t: "obj", entries: objNode.entries.filter(function (e) { return e[0] !== "hash"; }) };
  }

  /* events: array of parsed event nodes. Returns {ok, count, brokenSeq, detail} */
  function verifyChain(events) {
    let prev = GENESIS;
    for (let idx = 0; idx < events.length; idx++) {
      const ev = events[idx];
      const seq = intVal(getField(ev, "seq"));
      if (seq !== idx + 1) {
        return { ok: false, count: events.length, brokenSeq: seq || idx + 1,
                 detail: "seq discontinuity: position " + (idx + 1) + " holds seq " + seq };
      }
      if (strVal(getField(ev, "prev_hash")) !== prev) {
        return { ok: false, count: events.length, brokenSeq: seq,
                 detail: "prev_hash does not match the previous event's hash" };
      }
      if (eventHash(withoutHash(ev)) !== strVal(getField(ev, "hash"))) {
        return { ok: false, count: events.length, brokenSeq: seq,
                 detail: "hash mismatch: stored event content was altered" };
      }
      prev = strVal(getField(ev, "hash"));
    }
    return { ok: true, count: events.length, brokenSeq: null, detail: "chain intact" };
  }

  const api = { parseJSON: parseJSON, canonical: canonical, pretty: pretty,
                sha256Hex: sha256Hex, verifyChain: verifyChain,
                getField: getField, strVal: strVal, intVal: intVal, GENESIS: GENESIS };
  global.AgentTraceCanon = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
