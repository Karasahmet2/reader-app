"""Update 16.3: the chapter doesn't scroll behind an open sheet (your place stays), and sheets
close by dragging the handle (or the sheet, when it's at its top) down."""
import asyncio, sys, os
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        cdp = await ctx.new_cdp_session(page)
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        # a long chapter so there is something to scroll
        await ev("""import('./js/db.js').then(async d => { const t = await d.getText(1); const paras = t.paragraphs || t; })""")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]')
        await ev("document.querySelector('#text').style.paddingBottom = '3000px'")
        await ev("window.scrollTo(0, 400)"); await page.wait_for_timeout(500)
        y0 = await ev('scrollY')

        async def swipe(x, y1, y2, steps=8):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y1}]})
            for i in range(1, steps + 1):
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y1 + (y2 - y1) * i / steps}]})
                await page.wait_for_timeout(16)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            await page.wait_for_timeout(400)

        # 1 open the eye panel and try to scroll the chapter through it
        await ev("document.body.classList.add('controls-open')"); await page.wait_for_timeout(300)
        await page.click('.reader-top [data-action="notes-visibility"]'); await page.wait_for_selector('.sheet')
        y1 = await ev('scrollY')
        await page.mouse.move(195, 150); await page.mouse.wheel(0, 600); await page.wait_for_timeout(300)   # on the dark area
        box = await page.eval_on_selector('.sheet', 'e => { const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + 60]; }')
        await page.mouse.move(*box); await page.mouse.wheel(0, 600); await page.wait_for_timeout(300)       # on the sheet
        await swipe(195, 200, 40)                                                                             # finger on the dark area
        y2 = await ev('scrollY')
        locked = await ev("getComputedStyle(document.documentElement).overflow")
        print('1 scrollY before / open / after trying:', y0, y1, y2, '| html overflow:', locked)
        assert y0 == y1 == y2 and locked == 'hidden'

        # 2 drag the handle a little: it springs back
        g = await page.eval_on_selector('.sheet .grabber', 'e => { const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }')
        await page.mouse.move(*g); await page.mouse.down(); await page.mouse.move(g[0], g[1] + 40, steps=6); await page.mouse.up()
        await page.wait_for_timeout(400)
        still = await page.query_selector('.sheet') is not None
        print('2 small drag, still open:', still); assert still

        # 3 drag the handle far: it closes, and the chapter is where it was
        await page.mouse.move(*g); await page.mouse.down(); await page.mouse.move(g[0], g[1] + 250, steps=10); await page.mouse.up()
        await page.wait_for_timeout(600)
        gone = await page.query_selector('.sheet') is None
        y3 = await ev('scrollY'); h = await ev('location.hash')
        print('3 big drag closed:', gone, '| scrollY', y3, '| hash', h, '| html overflow', await ev("getComputedStyle(document.documentElement).overflow"))
        assert gone and y3 == y0 and h == '#/read/1'

        # 4 finger pull-down on the sheet itself (it's at its top) closes it too
        await ev("document.body.classList.add('controls-open')"); await page.wait_for_timeout(300)
        await page.click('.reader-top [data-action="notes-visibility"]'); await page.wait_for_selector('.sheet')
        top = await page.eval_on_selector('.sheet', 'e => e.getBoundingClientRect().y')
        await swipe(195, top + 80, top + 380)
        gone = await page.query_selector('.sheet') is None
        print('4 finger pull-down closed:', gone, '| scrollY', await ev('scrollY'))
        assert gone and await ev('scrollY') == y0

        # 5 finger swipe up on a sheet scrolls the sheet, doesn't close it
        await ev("document.body.classList.add('controls-open')"); await page.wait_for_timeout(300)
        await page.click('.reader-top [data-action="notes-visibility"]'); await page.wait_for_selector('.sheet')
        top = await page.eval_on_selector('.sheet', 'e => e.getBoundingClientRect().y')
        await swipe(195, top + 300, top + 100)
        print('5 swipe up, still open:', await page.query_selector('.sheet') is not None)
        assert await page.query_selector('.sheet') is not None
        await page.go_back(); await page.wait_for_timeout(400)
        assert await ev('scrollY') == y0
        print('errors:', errs)
        await b.close()

asyncio.run(main())
