"""Update 19: read aloud. Listen starts at the reading line; the sentence is lit; pause keeps the
place; next / previous; Read here from a selection; the settings sheet; stop clears everything."""
import asyncio, sys, os
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'

# A stand-in for the phone's voice: each sentence takes a short moment, then ends.
SPEECH = """(() => {
  const log = window.__ra = { spoken: [], cancelled: 0 };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.rate = 1; this.lang = ''; } };
  const ss = {
    _cur: null,
    getVoices: () => [{ name: 'English (US) test', lang: 'en-US', voiceURI: 'test-us' }],
    cancel() { log.cancelled++; this._cur = null; },
    pause() {}, resume() {},
    speak(u) { this._cur = u; log.spoken.push(u.text); setTimeout(() => { if (this._cur === u) { this._cur = null; u.onend && u.onend({}); } }, 1000); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: ss, configurable: true });
})();"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        await ctx.add_init_script(SPEECH)
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)

        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(500)
        # 1 Listen from the reading line (the reader's controls are open when a tap shows them)
        await ev("document.body.classList.add('controls-open')")
        await page.click('[data-action="read-aloud"]'); await page.wait_for_selector('.ra-bar:not([hidden])', timeout=4000)
        await page.wait_for_timeout(1400)
        info = (await page.inner_text('.ra-info')).replace('\n', ' | '); print('1 bar:', info)
        assert 'of 3' in info   # the fixture chapter has three sentences
        spoken = await ev('window.__ra.spoken.length'); print('  sentences spoken so far:', spoken); assert spoken >= 2
        lit = await ev("!!(window.CSS && CSS.highlights && CSS.highlights.has('ra-lit')) || document.querySelectorAll('.ra-lit-p').length > 0")
        print('  sentence lit:', lit); assert lit
        await page.screenshot(path=f'{SH}/v19-player.png')

        # 2 pause keeps the place; resume carries on from the same sentence
        await page.click('[data-ra="pause"]'); await page.wait_for_timeout(200)
        assert 'Paused' in await page.inner_text('.ra-info')
        n1 = await ev('window.__ra.spoken.length'); await page.wait_for_timeout(700)
        assert await ev('window.__ra.spoken.length') == n1, 'nothing more is spoken while paused'
        await page.click('[data-ra="pause"]'); await page.wait_for_timeout(500)
        assert 'Reading aloud' in await page.inner_text('.ra-info')
        print('2 pause and resume: ok')

        # 3 next sentence, then stop
        before = (await page.inner_text('.ra-info'))
        await page.click('[data-ra="next"]'); await page.wait_for_timeout(200)
        after = (await page.inner_text('.ra-info')); print('3 next:', before.split(chr(10))[-1], '→', after.split(chr(10))[-1])
        assert before.split(chr(10))[-1] != after.split(chr(10))[-1]
        await page.click('[data-ra="stop"]'); await page.wait_for_timeout(200)
        assert await page.locator('.ra-bar:not([hidden])').count() == 0
        cleared = await ev("!(window.CSS && CSS.highlights && CSS.highlights.has('ra-lit')) && document.querySelectorAll('.ra-lit-p').length === 0")
        assert cleared; print('  stopped and cleared: ok')

        # 4 Read from here: select a word in the 3rd paragraph
        await ev("""() => { const p=document.querySelector('#text p[data-p="2"]'); const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.search(/\\S{5,}/); if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+5); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return n.data.slice(i,i+5); } } }""")
        await page.wait_for_timeout(300)
        await page.click('[data-sel="read"]'); await page.wait_for_selector('.ra-bar:not([hidden])', timeout=4000)
        await page.wait_for_timeout(300)
        last = await ev('window.__ra.spoken[window.__ra.spoken.length - 1]'); print('4 read from here starts with:', last[:50])
        assert last.startswith('Winston thought'), last
        await page.click('[data-ra="stop"]'); await page.wait_for_timeout(150)

        # 5 settings: speed and stop-after are remembered
        await ev("document.body.classList.add('controls-open')")
        await page.click('[data-action="read-aloud"]'); await page.wait_for_timeout(300)
        await page.click('[data-ra="settings"]'); await page.wait_for_selector('[data-set-rate="1.5"]')
        await page.click('[data-set-rate="1.5"]'); await page.click('[data-set-stop="15"]'); await page.wait_for_timeout(150)
        rate = await ev("localStorage.getItem('reader-ra-rate')"); stop_after = await ev("localStorage.getItem('reader-ra-stop')")
        print('5 settings saved: rate', rate, 'stop', stop_after); assert rate == '1.5' and stop_after == '"15"'
        await page.screenshot(path=f'{SH}/v19-settings.png')
        print('errors:', errs)
        await b.close()

asyncio.run(main())
