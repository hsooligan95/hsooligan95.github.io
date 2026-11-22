#!/usr/bin/env python3
"""Browser verification for the dev site: loads the page in Chromium,
clicks the graph, exercises the tamper demo both ways, and runs the
Live Agent Ops Feed end-to-end on both channels (autoplay, typing,
decision cards, counters, roster states), with screenshots.
Run with the cloakqa venv python."""
import sys
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
    check("16 graph nodes", page.locator("#graph .node").count() == 16)
    check("default panel is agent-trace", "agent-trace" in page.locator("#node-panel h3").inner_text())
    check("tamper status VERIFIED on load",
          "CHAIN VERIFIED" in page.locator("#tamper-status").inner_text(),
          page.locator("#tamper-status").inner_text()[:60])
    check("chain list has 8 events", page.locator(".chain-row").count() == 8)
    check("project index rows", page.locator(".proj-row").count() == 16)

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

    # ---------- live ops feed, channel 1 ----------
    check("feed section present", page.locator("#feed").count() == 1)
    check("two channel tabs", page.locator(".chan-tab").count() == 2)
    check("roster has 7 rows on ch1", page.locator(".roster-row").count() == 7,
          str(page.locator(".roster-row").count()))
    page.locator("#run").scroll_into_view_if_needed()
    # autoplay on scroll into view: posts should start accumulating
    try:
        page.wait_for_function(
            "document.querySelectorAll('#feed .fm').length >= 4", timeout=15000)
        check("feed auto-plays when scrolled into view", True)
    except Exception:
        check("feed auto-plays when scrolled into view", False,
              "only %d posts" % page.locator("#feed .fm").count())
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

    check("no console/page errors overall", not errors, str(errors[:3]))

    mob = browser.new_page(viewport={"width": 390, "height": 844})
    merrors = []
    mob.on("pageerror", lambda e: merrors.append(str(e)))
    mob.goto(URL); mob.wait_for_timeout(600)
    mob.locator("#run").scroll_into_view_if_needed()
    try:
        mob.wait_for_function(
            "document.querySelectorAll('#feed .fm').length >= 3", timeout=15000)
        check("mobile feed auto-plays", True)
    except Exception:
        check("mobile feed auto-plays", False)
    mob.screenshot(path="shots/mobile-feed.png")
    check("mobile: no page errors", not merrors, str(merrors[:2]))
    browser.close()

print("RESULT:", "FAIL " + str(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
