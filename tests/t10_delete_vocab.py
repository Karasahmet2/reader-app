"""Update 16.2: deleting a saved word's last spot removes the word too (no dotted line left);
Undo brings both back; words left over from before are cleaned up at start."""
import asyncio, sys, os
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'
SEL = """(text) => { for(const p of document.querySelectorAll('#text p[data-p]')){ const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf(text); if(i>=0){ p.scrollIntoView({block:'center'}); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+text.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } } }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await ev("import('./js/dictionary.js').then(d => d.downloadPack(() => {}))")
        await ev("localStorage.setItem('reader-define-tab', 'pack')")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(800)

        async def marks():
            await page.wait_for_timeout(700)
            return await ev("""() => ({ dots: [...document.querySelectorAll('span.wd-met')].map(x => x.textContent),
                spots: [...document.querySelectorAll('mark.note-mark')].map(x => x.textContent),
                words: null })""")
        async def nwords(): return await ev("import('./js/db.js').then(d => d.getAllWords()).then(l => l.map(w => w.word))")

        # 1 save "Party" from Define
        assert await ev(SEL, 'Party')
        await page.wait_for_timeout(400); await page.click('[data-sel="define"]')
        await page.wait_for_selector('.def-sense', timeout=20000)
        await page.click('[data-def="note"]'); await page.wait_for_selector('.wd-save')
        await page.click('.wd-save [data-wd="new"]'); await page.wait_for_timeout(900)
        m = await marks(); w = await nwords()
        print('1 saved:', m, w)
        assert 'Party' in m['spots'] and w == ['party']

        # 2 Remove this spot → the word goes too, no dots anywhere
        await page.evaluate("document.querySelector('mark.note-mark[data-word]').click()")
        await page.wait_for_selector('.wd-card')
        await page.click('[data-wc="remove"]')
        m = await marks(); w = await nwords()
        print('2 after remove:', m, w)
        assert not m['dots'] and not m['spots'] and w == []
        await page.goto(B + '#/read/2'); await page.wait_for_selector('#text p[data-p]')
        m = await marks(); print('  chapter 2:', m)
        assert not m['dots']

        # 3 Undo from the Trash brings word and spot back
        await page.goto(B + '#/trash'); await page.wait_for_timeout(800)
        trash = (await page.inner_text('#app')).replace('\n', ' | ')
        print('3 trash:', trash[:200])
        await ev("""import('./js/db.js').then(async d => { const t = (await d.getAllTrash())[0]; const tr = await import('./js/trash.js'); await tr.restore(t.id); })""")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]')
        m = await marks(); w = await nwords(); print('  restored:', m, w)
        assert 'Party' in m['spots'] and w == ['party']

        # 4 a word left behind earlier (no spots) is cleaned up at start
        await ev("import('./js/db.js').then(d => d.putWord({ word: 'grimy', forms: [], meanings: [], keys: ['grimy'] }))")
        await page.reload(); await page.wait_for_selector('#text p[data-p]')
        m = await marks(); w = await nwords(); print('4 after restart:', m, w)
        assert 'grimy' not in w and 'grimy' not in m['dots']
        print('errors:', errs)
        await b.close()

asyncio.run(main())
