#!/usr/bin/env python3
"""Browser verification for the dev site: loads the page in Chromium,
clicks the graph, exercises the tamper demo both ways, and runs the
Agent Ops Feed (recorded replay) end-to-end on both channels
(autoplay, pacing, typing, decision cards, counters, roster states),
with screenshots.
Run with the cloakqa venv python."""
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8901/index.html"
fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + extra if extra else ""))
    if not cond: fails.append(name)

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path="/home/hatch/.cloakbrowser/chromium-146.0.7680.177.5/chrome",
        args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_timeout(600)

    check("no console/page errors on load", not errors, str(errors[:3]))
    check("15 graph nodes", page.locator("#graph .node").count() == 15)
    check("default panel is agent-trace", "agent-trace" in page.locator("#node-panel h3").inner_text())
    check("tamper status VERIFIED on load",
          "CHAIN VERIFIED" in page.locator("#tamper-status").inner_text(),
          page.locator("#tamper-status").inner_text()[:60])
    check("chain list has 8 events", page.locator(".chain-row").count() == 8)
    check("project index rows", page.locator(".proj-row").count() == 15)

    # ---------- pulumi removal ----------
    check("no 'pulumi' anywhere in the page",
          page.evaluate("!document.body.innerText.toLowerCase().includes('pulumi')"))
    check("PROJECTS data has exactly 15 entries, none retired",
          page.evaluate("window.PROJECTS.length === 15 && "
                        "!window.PROJECTS.some(p => p.id.toLowerCase().includes('pulumi'))"))
    check("headline counts fifteen",
          page.locator(".hero-head h1").inner_text() == "One platform, fifteen parts.")

    # ---------- providers strip ----------
    check("providers strip shows 4 provider chips",
          page.locator(".prov-chip").count() == 4,
          str(page.locator(".prov-chip").count()))
    check("providers strip carries the honest adapter line",
          "Adapters plug in underneath" in page.locator(".providers-strip").inner_text()
          and "Today's adapters are AWS" in page.locator(".providers-strip").inner_text())
    page.locator(".providers-strip").scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    page.screenshot(path="shots/desktop-providers.png")

    # ---------- rich per-agent panels ----------
    check("every project carries a provider tag in data",
          page.evaluate("window.PROJECTS.every(p => p.provider && p.provider.length > 3)"))
    check("index rows show 15 provider tags",
          page.locator(".pr-prov").count() == 15,
          str(page.locator(".pr-prov").count()))

    def panel_check(pid, provider_frag):
        page.locator('#graph .node[data-id="%s"]' % pid).click()
        page.wait_for_timeout(200)
        txt = page.locator("#node-panel").inner_text()
        low = txt.lower()
        ok = ("purpose" in low and "what makes it unique" in low
              and "consumes" in low and "produces" in low and "talks to" in low
              and provider_frag.lower() in low)
        check("rich panel: " + pid, ok, txt[:80].replace("\n", " "))
        return txt

    panel_check("agent-gate", "Provider-agnostic")
    page.screenshot(path="shots/desktop-panel-gate.png")
    panel_check("cred-broker", "Provider-agnostic")
    panel_check("blast-radius", "AWS (mock) execution adapter")
    panel_check("agentcore-port", "AWS adapter")
    panel_check("mcp-aws-explorer", "AWS adapter")

    # talks-to chips navigate: from agent-gate, click the cred-broker chip
    page.locator('#graph .node[data-id="agent-gate"]').click()
    page.wait_for_timeout(150)
    page.locator('.talk-chip[data-talk="cred-broker"]').click()
    page.wait_for_timeout(200)
    check("talks-to chip navigates gate -> cred-broker",
          "cred-broker" in page.locator("#node-panel h3").inner_text()
          and page.locator('#graph .node[data-id="cred-broker"].selected').count() == 1)

    # ---------- guided walkthrough ----------
    TOUR_EXPECT = [
        ("The working agent", ["factory-floor-agent"]),
        ("Gated before it runs", ["agent-canary"]),
        ("Credentials, scoped down", ["agent-gate", "cred-broker"]),
        ("Policy at the door", ["agent-gate"]),
        ("Execution with a way back", ["blast-radius"]),
        ("Every step metered", ["agent-ledger"]),
        ("One record of everything", ["agent-trace"]),
        ("Proven before production", ["agent-chaos", "agent-flightsim"]),
        ("Disagreement, arbitrated", ["mission-control"]),
        ("Evidence for the assessor", ["ato-in-a-box"]),
        ("How it scales", None),  # all 15 hot
    ]
    page.locator("#tour-btn").click()
    page.wait_for_timeout(400)
    for i, (title, hot) in enumerate(TOUR_EXPECT):
        h3 = page.locator("#node-panel h3").inner_text()
        check("tour step %d title" % (i + 1), h3 == title, h3)
        hot_ids = page.evaluate(
            "Array.from(document.querySelectorAll('#graph .node.tour-hot'))"
            ".map(g => g.dataset.id).sort()")
        if hot is None:
            check("tour step %d highlights all 15 nodes" % (i + 1),
                  len(hot_ids) == 15, str(len(hot_ids)))
            check("tour final step links the nightly drill",
                  page.locator('#node-panel a[href*="nightly-drill"]').count() == 1)
            page.screenshot(path="shots/desktop-tour-scale.png")
        else:
            check("tour step %d highlights the right nodes" % (i + 1),
                  hot_ids == sorted(hot), str(hot_ids))
        check("tour step %d dims the rest" % (i + 1),
              page.evaluate("document.querySelectorAll('#graph .node.dim').length")
              == 15 - (len(hot) if hot else 15))
        check("tour step %d caption present" % (i + 1),
              len(page.locator("#node-panel .np-tour-body").inner_text()) > 60
              and "flowed" in page.locator("#node-panel").inner_text().lower())
        if i == 2:
            check("tour step 3 draws the broker->gate arc",
                  page.locator("#graph .tour-arc").count() == 1)
        if i == 3:
            page.wait_for_timeout(300)
            page.screenshot(path="shots/desktop-tour-gate.png")
        if i < len(TOUR_EXPECT) - 1:
            page.locator("#tour-next").click()
            page.wait_for_timeout(250)
    check("tour pulse animation is running",
          page.locator("#graph .tour-pulse").count() >= 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    check("Esc exits the tour back to free exploration",
          page.locator("#graph .node.tour-hot").count() == 0
          and page.locator("#graph .node.dim").count() == 0
          and "purpose" in page.locator("#node-panel").inner_text().lower())

    # graph click-through
    page.locator('#graph .node[data-id="blast-radius"]').click()
    page.wait_for_timeout(200)
    check("click blast-radius updates panel",
          "kill -9" in page.locator("#node-panel").inner_text())

    # tamper: flip in seq 1 -> BROKEN @ SEQ 1
    page.locator("#flip-btn").click()
    page.wait_for_timeout(200)
    st = page.locator("#tamper-status").inner_text()
    check("flip seq1 -> BROKEN @ SEQ 1", "BROKEN @ SEQ 1" in st, st[:70])
    page.locator("#reset-btn").click()
    page.wait_for_timeout(200)
    check("reset -> VERIFIED", "CHAIN VERIFIED" in page.locator("#tamper-status").inner_text())
    page.locator(".chain-row").nth(4).click()
    page.locator("#flip-btn").click()
    page.wait_for_timeout(200)
    st = page.locator("#tamper-status").inner_text()
    check("flip seq5 -> BROKEN @ SEQ 5", "BROKEN @ SEQ 5" in st, st[:70])
    page.locator("#reset-btn").click()

    # ---------- ops feed (recorded replay), channel 1 ----------
    check("feed section present", page.locator("#feed").count() == 1)
    chip = page.locator(".replay-chip")
    check("REPLAY chip present in feed header",
          chip.count() == 1 and "REPLAY" in chip.inner_text()
          and "recorded run" in chip.inner_text(),
          chip.inner_text() if chip.count() else "missing")
    note = page.locator(".replay-note")
    check("recorded-run line present under the intro",
          note.count() == 1 and "Recorded from an actual run" in note.inner_text())
    check("recorded-run line links to the agent-trace repo",
          note.count() == 1 and note.locator("a").get_attribute("href")
          == "https://github.com/hsooligan95/agent-trace")
    check("feed heading no longer claims 'Live'",
          page.locator("#run h2").inner_text() == "Agent ops feed",
          page.locator("#run h2").inner_text())
    check("three channel tabs", page.locator(".chan-tab").count() == 3)
    check("third tab is #stale-corpus",
          page.locator('.chan-tab[data-chan="2"]').inner_text() == "#stale-corpus")
    check("roster has 7 rows on ch1", page.locator(".roster-row").count() == 7,
          str(page.locator(".roster-row").count()))
    page.locator("#run").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path="shots/desktop-feed-header.png")
    # autoplay on scroll into view: posts should start accumulating
    t0 = time.time()
    try:
        page.wait_for_function(
            "document.querySelectorAll('#feed .fm').length >= 4", timeout=15000)
        check("feed auto-plays when scrolled into view", True)
    except Exception:
        check("feed auto-plays when scrolled into view", False,
              "only %d posts" % page.locator("#feed .fm").count())
    # pacing: the slowed 1x base should take >=15s to land the first 10
    # posts (the pre-fix pace did it in ~12s; the model says ~24s)
    try:
        page.wait_for_function(
            "document.querySelectorAll('#feed .fm:not(.fm-typing)').length >= 10",
            timeout=60000)
        elapsed = time.time() - t0
        check("pacing: first 10 posts take >=15s at 1x", elapsed >= 15,
              "%.1fs" % elapsed)
    except Exception:
        check("pacing: first 10 posts take >=15s at 1x", False,
              "only %d landed posts" %
              page.locator("#feed .fm:not(.fm-typing)").count())
    # roster status changes while running
    blast_status = page.locator(".roster-row", has_text="blast-radius").locator(".r-status").inner_text()
    check("roster statuses are live", blast_status != "" , blast_status)
    # speed up and run to completion
    page.locator('.speed-btn[data-speed="4"]').click()
    try:
        page.wait_for_function(
            "document.querySelector('#feed-status').textContent.startsWith('complete')",
            timeout=60000)
        check("channel 1 runs to completion", True)
    except Exception:
        check("channel 1 runs to completion", False,
              page.locator("#feed-status").inner_text())
    check("ch1 events counter reaches 117 / 117",
          page.locator("#st-events").inner_text() == "117 / 117",
          page.locator("#st-events").inner_text())
    check("ch1 cost reaches $0.57313",
          page.locator("#st-cost").inner_text() == "$0.57313",
          page.locator("#st-cost").inner_text())
    check("ch1 chain pill VERIFIED", page.locator("#st-chain").inner_text() == "VERIFIED")
    ndec = page.locator("#feed .fm-decision").count()
    check("ch1 decision cards render (5)", ndec == 5, str(ndec))
    check("ch1 decisions log matches cards",
          page.locator("#decisions .dec-row").count() == 5,
          str(page.locator("#decisions .dec-row").count()))
    feed_text = page.locator("#feed").inner_text()
    check("ch1 shows canary BLOCK card", "BLOCK — promotion denied" in feed_text)
    check("ch1 shows kill banner", "SIGKILL" in feed_text)
    check("ch1 shows rollback card", "ROLL BACK — verification failed" in feed_text)
    check("hub count reaches 117", page.locator("#hub-count").text_content() == "117 events",
          page.locator("#hub-count").text_content())
    page.screenshot(path="shots/desktop-feed-done.png")

    # pause / resume sanity on restart
    page.locator("#restart-btn").click()
    page.wait_for_timeout(1200)
    n_mid = page.locator("#feed .fm").count()
    check("restart replays the feed", 1 <= n_mid <= 12, str(n_mid))
    page.screenshot(path="shots/desktop-feed-mid.png")
    page.locator("#play-btn").click()  # pause
    frozen = page.locator("#feed .fm").count()
    page.wait_for_timeout(1500)
    check("pause freezes the feed",
          page.locator("#feed .fm").count() == frozen,
          "%d -> %d" % (frozen, page.locator("#feed .fm").count()))

    # ---------- channel 2: incident arbitration ----------
    page.locator('.chan-tab[data-chan="1"]').click()
    page.wait_for_timeout(400)
    check("ch2 roster swaps to incident agents",
          page.locator(".roster-row").count() == 3,
          str(page.locator(".roster-row").count()))
    check("ch2 cost row hidden", page.locator("#st-cost-row").is_hidden())
    try:
        page.wait_for_function(
            "document.querySelector('#feed-status').textContent.startsWith('complete')",
            timeout=60000)
        check("channel 2 runs to completion", True)
    except Exception:
        check("channel 2 runs to completion", False,
              page.locator("#feed-status").inner_text())
    feed2 = page.locator("#feed").inner_text()
    check("ch2 ends on ROLLBACK decision card",
          "ROLLBACK — evidence over confidence" in feed2)
    check("ch2 shows the disagreement (SCALE 0.8 vs ROLLBACK 0.6)",
          "Confidence 0.8" in feed2 and "Confidence 0.6" in feed2)
    check("ch2 shows arbiter evidence steps",
          "Evidence 1/3" in feed2 and "Evidence 3/3" in feed2)
    check("ch2 decisions log has the rollback",
          page.locator("#decisions .dec-row").count() == 1 and
          "ROLLBACK" in page.locator("#decisions").inner_text())
    check("ch2 events counter reaches 12 / 12",
          page.locator("#st-events").inner_text() == "12 / 12",
          page.locator("#st-events").inner_text())
    page.locator("#feed").scroll_into_view_if_needed()
    page.screenshot(path="shots/desktop-feed-ch2.png")

    # ---------- channel 3: stale corpus (AgentFlightSim) ----------
    page.locator('.speed-btn[data-speed="1"]').click()
    page.locator('.chan-tab[data-chan="2"]').click()
    page.wait_for_timeout(400)
    check("ch3 roster swaps to flightsim + agent + oracles",
          page.locator(".roster-row").count() == 4,
          str(page.locator(".roster-row").count()))
    roster3 = page.locator("#roster-list").inner_text()
    check("ch3 oracles marked as checkers in the roster",
          "freshness-oracle" in roster3 and "consistency-oracle" in roster3
          and "checker" in roster3)
    check("ch3 cost row hidden (no cost in the artifacts)",
          page.locator("#st-cost-row").is_hidden())
    check("ch3 heading is the stale-corpus story",
          "stale corpus" in page.locator("#feed-heading").inner_text(),
          page.locator("#feed-heading").inner_text())
    try:
        page.wait_for_function(
            "document.querySelectorAll('#feed .fm:not(.fm-typing)').length >= 6",
            timeout=30000)
        check("ch3 mid-run posts accumulate", True)
    except Exception:
        check("ch3 mid-run posts accumulate", False,
              str(page.locator("#feed .fm").count()))
    page.screenshot(path="shots/desktop-feed-ch3.png")
    page.locator('.speed-btn[data-speed="4"]').click()
    try:
        page.wait_for_function(
            "document.querySelector('#feed-status').textContent.startsWith('complete')",
            timeout=60000)
        check("channel 3 runs to completion", True)
    except Exception:
        check("channel 3 runs to completion", False,
              page.locator("#feed-status").inner_text())
    feed3 = page.locator("#feed").inner_text()
    check("ch3 carries the exact recorded answer",
          "The HP-40 hydraulic pump on Line 3 is operational and running normally"
          in feed3 and "No maintenance hold is active on the HP-40 pump" in feed3)
    check("ch3 posts are labelled from the run log, not the store",
          "log @ post 5" in feed3)
    card = page.locator("#feed .fm-decision")
    check("ch3 has exactly one decision card, in the fail tone",
          card.count() == 1 and "fm-fail" in (card.get_attribute("class") or ""),
          card.get_attribute("class") if card.count() else "none")
    check("ch3 decision card is the SILENT FAILURE card",
          "SILENT FAILURE — fully grounded, factually wrong" in feed3
          and "groundedness scorer: PASS" in feed3
          and "freshness oracle: FLAGGED" in feed3)
    check("ch3 decisions log has the silent failure",
          page.locator("#decisions .dec-row").count() == 1
          and "SILENT FAILURE" in page.locator("#decisions").inner_text())
    check("ch3 grid totals are the real ones",
          "43/108" in feed3 and "72 findings" in feed3
          and "42 stale-as-current" in feed3 and "0 of 18 runs pass" in feed3)
    check("ch3 events counter reaches 14 / 14",
          page.locator("#st-events").inner_text() == "14 / 14",
          page.locator("#st-events").inner_text())
    check("ch3 chain pill still VERIFIED",
          page.locator("#st-chain").inner_text() == "VERIFIED")
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path="shots/desktop-feed-ch3-decision.png")

    check("no console/page errors overall", not errors, str(errors[:3]))

    mob = browser.new_page(viewport={"width": 390, "height": 844})
    merrors = []
    mob.on("pageerror", lambda e: merrors.append(str(e)))
    mob.goto(URL); mob.wait_for_timeout(600)
    check("mobile: REPLAY chip present",
          mob.locator(".replay-chip").count() == 1
          and "REPLAY" in mob.locator(".replay-chip").inner_text())
    mob.locator("#tour-btn").click()
    mob.wait_for_timeout(400)
    check("mobile: tour starts with step 1 caption",
          mob.locator("#node-panel h3").inner_text() == "The working agent"
          and mob.locator("#graph .node.tour-hot").count() == 1)
    mob.locator("#tour-next").click()
    mob.wait_for_timeout(300)
    check("mobile: tour advances to step 2",
          mob.locator("#node-panel h3").inner_text() == "Gated before it runs")
    mob.screenshot(path="shots/mobile-tour.png")
    mob.locator("#tour-exit").click()
    mob.wait_for_timeout(200)
    check("mobile: tour exit restores the panel",
          "purpose" in mob.locator("#node-panel").inner_text().lower())
    mob.locator("#run").scroll_into_view_if_needed()
    mob.wait_for_timeout(300)
    mob.screenshot(path="shots/mobile-feed-header.png")
    try:
        mob.wait_for_function(
            "document.querySelectorAll('#feed .fm').length >= 3", timeout=15000)
        check("mobile feed auto-plays", True)
    except Exception:
        check("mobile feed auto-plays", False)
    mob.screenshot(path="shots/mobile-feed.png")
    mob.locator('.chan-tab[data-chan="2"]').click()
    try:
        mob.wait_for_function(
            "document.querySelectorAll('#feed .fm').length >= 3", timeout=20000)
        check("mobile ch3 (#stale-corpus) plays", True)
    except Exception:
        check("mobile ch3 (#stale-corpus) plays", False)
    mob.screenshot(path="shots/mobile-feed-ch3.png")
    check("mobile: no page errors", not merrors, str(merrors[:2]))
    browser.close()

print("RESULT:", "FAIL " + str(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
