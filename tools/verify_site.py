#!/usr/bin/env python3
"""Browser verification for the dev site: loads the page in Chromium,
clicks the graph, runs the replay, exercises the tamper demo both ways,
and screenshots desktop + mobile. Run with the cloakqa venv python."""
import sys, time
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

    check("no console/page errors", not errors, str(errors[:3]))
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
    # reset -> verified
    page.locator("#reset-btn").click()
    page.wait_for_timeout(200)
    check("reset -> VERIFIED", "CHAIN VERIFIED" in page.locator("#tamper-status").inner_text())
    # select seq 5, flip -> BROKEN @ SEQ 5
    page.locator(".chain-row").nth(4).click()
    page.locator("#flip-btn").click()
    page.wait_for_timeout(200)
    st = page.locator("#tamper-status").inner_text()
    check("flip seq5 -> BROKEN @ SEQ 5", "BROKEN @ SEQ 5" in st, st[:70])
    page.locator("#reset-btn").click()

    # replay: play for ~2.5s then pause
    page.locator("#run").scroll_into_view_if_needed()
    page.locator("#play-btn").click()
    page.wait_for_timeout(2500)
    mid = page.locator("#stat-events").inner_text()
    check("replay advances", mid != "0 / 117", mid)
    lit = page.locator(".beat.lit").count()
    check("beats light during replay", lit >= 2, f"{lit} lit")
    page.locator("#play-btn").click()  # pause
    # scrub to end
    page.locator("#scrub").fill("117")
    page.wait_for_timeout(300)
    check("events reach 117/117", page.locator("#stat-events").inner_text() == "117 / 117")
    check("cost reaches $0.57313", page.locator("#stat-cost").inner_text() == "$0.57313",
          page.locator("#stat-cost").inner_text())
    check("all 9 beats lit at end", page.locator(".beat.lit").count() == 9)
    check("hub count 117", page.locator("#hub-count").text_content() == "117 events")

    page.screenshot(path="shots/desktop-top.png")
    page.locator("#run").scroll_into_view_if_needed(); page.wait_for_timeout(300)
    page.screenshot(path="shots/desktop-replay.png")
    page.locator("#tamper").scroll_into_view_if_needed(); page.wait_for_timeout(300)
    page.screenshot(path="shots/desktop-tamper.png")

    mob = browser.new_page(viewport={"width": 390, "height": 844})
    mob.goto(URL); mob.wait_for_timeout(600)
    mob.screenshot(path="shots/mobile-top.png", full_page=False)
    check("mobile loads, nodes present", mob.locator("#graph .node").count() == 16)
    browser.close()

print("RESULT:", "FAIL " + str(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
