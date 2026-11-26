"""Update 17.6: Merriam-Webster problems are told apart — a refused key is not "no connection";
Try again after a failed connection; Settings → Test keys says what's wrong with each key."""
import asyncio, sys, os, json
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'
SEL = """(text) => { for(const p of document.querySelectorAll('#text p[data-p]')){ const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf(text); if(i>=0){ p.scrollIntoView({block:'center'}); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+text.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } } }"""
GOOD = [{'meta': {'id': 'glass', 'stems': ['glass']}, 'hwi': {'hw': 'glass', 'prs': [{'ipa': 'ɡlæs'}]}, 'fl': 'noun',
         'def': [{'sseq': [[['sense', {'sn': '1', 'dt': [['text', 'a hard clear material used for windows']]}]]]}]}]
mode = {'mw': 'badkey'}

async def mw(route):
    m = mode['mw']
    if m == 'badkey': await route.fulfill(status=200, content_type='text/html', body='Invalid API key. Not subscribed for this reference.')
    elif m == 'down': await route.abort('failed')
    elif m == 'error': await route.fulfill(status=503, body='busy')
    else: await route.fulfill(status=200, content_type='application/json', body=json.dumps(GOOD))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await ctx.route('https://www.dictionaryapi.com/**', mw)
        await ctx.route('https://freedictionaryapi.com/**', lambda r: r.fulfill(status=404, body='{}'))
        await ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
        ev = page.evaluate
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)

        # keys typed in Settings; Test keys says the key was refused
        await page.goto(B + '#/settings'); await page.wait_for_selector('[data-dict-key="mwLearnersKey"]')
        await page.fill('[data-dict-key="mwLearnersKey"]', 'my-learners-key')
        await page.click('[data-action="dict-test"]'); await page.wait_for_selector('.key-res')
        res = (await page.inner_text('#key-test-result')).replace('\n', ' | '); print('1 test keys (refused):', res)
        assert 'Key not accepted' in res and 'Collegiate: No key' in res
        await page.locator('.key-test').scroll_into_view_if_needed()
        await page.screenshot(path=f'{SH}/v176-testkeys.png')

        # Define: "Key problem", not "No connection"
        await ev("localStorage.setItem('reader-define-tab', 'mw')")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(600)
        assert await ev(SEL, 'glass'); await page.wait_for_timeout(300); await page.click('[data-sel="define"]')
        await page.wait_for_selector('.def-sub'); await page.wait_for_timeout(800)
        txt = (await page.inner_text('.sheet')).replace('\n', ' | '); print('2 define, refused key:', txt[:220])
        assert 'Key problem' in txt and 'No connection' not in txt and 'key problem' in txt
        await page.screenshot(path=f'{SH}/v176-keyproblem.png')
        await page.go_back(); await page.wait_for_timeout(300)

        # connection fails → clear message + Try again; then it works
        mode['mw'] = 'down'
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(600)
        assert await ev(SEL, 'glass'); await page.wait_for_timeout(300); await page.click('[data-sel="define"]')
        await page.wait_for_selector('[data-def="retry"]', timeout=20000)
        txt = (await page.inner_text('.sheet')).replace('\n', ' | '); print('3 connection failed:', txt[:220])
        assert 'Couldn’t reach Merriam-Webster' in txt
        mode['mw'] = 'good'
        await page.click('[data-def="retry"]'); await page.wait_for_selector('.def-sense', timeout=20000)
        txt = await page.inner_text('.sheet'); print('  after Try again:', txt.replace('\n', ' | ')[:120])
        assert 'hard clear material' in txt
        await page.go_back(); await page.wait_for_timeout(300)

        # a server error says so
        mode['mw'] = 'error'
        assert await ev("import('./js/dictionary.js').then(d => d.mwProblem('http:503'))") == 'Merriam-Webster answered with an error (503). Try again later.'
        # Test keys when it works
        mode['mw'] = 'good'
        await page.goto(B + '#/settings'); await page.wait_for_selector('[data-action="dict-test"]')
        await page.click('[data-action="dict-test"]'); await page.wait_for_selector('.key-res.is-ok')
        res = (await page.inner_text('#key-test-result')).replace('\n', ' | '); print('4 test keys (good):', res)
        assert 'Learner’s: Works' in res
        print('errors:', errs)
        await b.close()

asyncio.run(main())
