"""Walk-through: move between every page, sheet and window with the app's own buttons and the
phone's back gesture, and report anything that lands in the wrong place or breaks."""
import asyncio, sys, os
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'; O = f'{S}/fixtures/other'
issues = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate

        async def where():
            await page.wait_for_timeout(450)
            return await ev("""() => ({ h: location.hash || '#/', sheet: !!document.querySelector('.sheet, .panel, .overlay-page'),
                broken: !!document.body.innerText.match(/Something went wrong/), title: (document.querySelector('h1, .titles b')?.textContent || '').trim().slice(0, 40) })""")

        async def check(label, want_hash=None, sheet=None):
            w = await where()
            ok = (want_hash is None or w['h'] == want_hash) and (sheet is None or w['sheet'] == sheet) and not w['broken']
            print(('ok   ' if ok else 'ISSUE'), label, '→', w)
            if not ok: issues.append((label, w))
            return w

        async def rtop(sel):  # tap the page to show the reader's top bar, then press the button
            await ev("document.body.classList.add('controls-open')"); await page.wait_for_timeout(350)
            await page.click(sel)

        async def back(label, want_hash=None, sheet=None):
            await page.go_back(); return await check('[phone back] ' + label, want_hash, sheet)

        # ---- setup: two series
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt', f'{D}/1984 ch3.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{O}/other 1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await ev("""import('./js/db.js').then(async d => {
            const k = await d.putWord({ word: 'glass', forms: ['glasses'], meanings: [{ pos: 'noun', text: 'a hard clear material', src: 'pack' }], keys: ['glass','glasses'] });
            await d.putNote({ seriesId: 2, chapterId: 4, sp: null, quote: 'glass', text: '', tagIds: [], wordId: k.id, createdAt: 0, updatedAt: 0 });
        })""")
        # fresh start, like opening the app from the home screen
        await page.goto(B + 'index.html'); await page.reload(); await page.wait_for_timeout(1200)
        await check('start', '#/')

        print('\n-- 1 bottom bar')
        for h in ['#/import', '#/sounds', '#/settings', '#/']:
            await page.click(f'.bottom-nav a[href="{h}"]'); await check('tab ' + h, h)
        await back('from library after tabs', '#/settings')
        await page.click('.bottom-nav a[href="#/"]'); await page.wait_for_timeout(300)

        print('\n-- 2 settings → backup / trash and back')
        await page.click('.bottom-nav a[href="#/settings"]'); await page.wait_for_timeout(300)
        await page.click('a[href="#/backup"] >> nth=-1'); await check('backup', '#/backup')
        await page.click('a[data-back]'); await check('backup back arrow', '#/settings')
        await page.click('a[href="#/trash"]'); await check('trash', '#/trash')
        await back('trash', '#/settings')

        print('\n-- 3 library → series → tabs → chapter')
        await page.click('.bottom-nav a[href="#/"]'); await page.wait_for_timeout(300)
        await page.click('a[href="#/series/1"] >> nth=0'); await check('series 1', '#/series/1')
        for tab in ['notes', 'codex', 'tags', 'chapters']:
            await page.click(f'[data-tab="{tab}"]'); w = await check('tab ' + tab)
        await page.click('[data-tab="codex"]'); await page.wait_for_timeout(300)
        h_codex = (await where())['h']
        await page.click('[data-tab="chapters"]'); await page.wait_for_timeout(300)
        h_after_tabs = (await where())['h']
        await page.click('.chapter-list a >> nth=0'); await check('chapter 1', '#/read/1')
        await rtop('.reader-top a[data-back]'); await check('reader back arrow → series', h_after_tabs)
        await page.click('.chapter-list a >> nth=0'); await page.wait_for_timeout(500)

        print('\n-- 4 chapter to chapter, then back')
        nxt = await page.query_selector('a[data-replace][href="#/read/2"]')
        if nxt:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await nxt.click(); await check('next chapter', '#/read/2')
            await rtop('.reader-top a[data-back]'); await check('back from ch2 → series, not ch1', '#/series/1')
        else:
            issues.append(('no next chapter link', None))
        await page.click('.chapter-list a >> nth=1'); await page.wait_for_timeout(500)
        await rtop('.reader-top a[data-up]'); await check('chapter list button', '#/series/1')
        await back('after chapter list button', None)

        print('\n-- 5 reader sheets and phone back')
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]')
        for act in ['notes-visibility', 'open-sounds']:
            await rtop(f'.reader-top [data-action="{act}"]'); await check('open ' + act, '#/read/1', True)
            await back('close ' + act, '#/read/1', False)
        await ev("document.body.classList.add('controls-open')"); await page.wait_for_timeout(350)
        jump = await page.query_selector('[data-action="jump"]')
        if jump and await jump.is_visible():
            await jump.click(); await check('jump sheet', '#/read/1', True)
            await back('close jump sheet', '#/read/1', False)
        # a saved word met in the text → word card
        met = await page.query_selector('span.wd-met')
        if met:
            await met.scroll_into_view_if_needed(); await met.click(); await check('word card from dot', '#/read/1', True)
            await page.click('[data-wc="edit"]'); await check('word card → forms sheet', '#/read/1', True)
            await back('forms sheet: phone back (expect word card again)', '#/read/1', True)
            txt = await ev("document.querySelector('.wd-box') ? 'card' : (document.querySelector('.sheet') ? 'other sheet' : 'none')")
            print('      after back we see:', txt)
            if txt != 'card': issues.append(('phone back from Forms sheet does not return to the word card', txt))
            if await page.query_selector('.sheet'): await page.go_back(); await page.wait_for_timeout(300)
            await met.click(); await page.wait_for_timeout(400)
            await page.click('[data-wc="define"]'); await page.wait_for_timeout(800)
            await back('define from word card: phone back (expect word card)', '#/read/1', True)
            txt = await ev("document.querySelector('.wd-box') ? 'card' : (document.querySelector('.sheet') ? 'other sheet' : 'none')")
            print('      after back we see:', txt)
            if txt != 'card': issues.append(('phone back from Define does not return to the word card', txt))
            if await page.query_selector('.sheet'): await page.go_back(); await page.wait_for_timeout(300)
        else:
            issues.append(('no met-again dot for glass', None))
        await check('reader clean after sheets', '#/read/1', False)

        print('\n-- 6 notes → words → word card → place')
        await page.goto(B + '#/'); await page.wait_for_timeout(500)
        await page.click('a[href="#/notes"] >> nth=0'); await check('notes page', '#/notes')
        await page.click('a.notes-words'); await check('words page', '#/words')
        await page.click('.word-row >> nth=0'); await check('word card from list', '#/words', True)
        await back('close word card', '#/words', False)
        await page.click('a[data-back]'); await check('words back arrow', '#/notes')
        await page.click('a[data-back]'); await check('notes back arrow', '#/')

        print('\n-- 7 opening pages directly (bookmark / reload) and pressing the back arrow')
        for h, arrow, want in [('#/read/2', '.reader-top a[data-back]', '#/series/1'), ('#/words', 'a[data-back]', '#/notes'),
                               ('#/trash', 'a[data-back]', '#/settings'), ('#/backup', 'a[data-back]', '#/settings'),
                               ('#/notes', 'a[data-back]', '#/')]:
            p2 = await ctx.new_page(); p2.on('pageerror', lambda e: errs.append(str(e)))
            await p2.goto(B + h); await p2.wait_for_timeout(900)
            await p2.evaluate("document.body.classList.add('controls-open')"); await p2.wait_for_timeout(350)
            await p2.click(arrow); await p2.wait_for_timeout(500)
            got = await p2.evaluate("location.hash || '#/'")
            ok = got == want; print(('ok   ' if ok else 'ISSUE'), 'cold', h, 'back arrow →', got)
            if not ok: issues.append(('cold ' + h, got))
            await p2.close()

        print('\n-- 8 missing things')
        for h in ['#/read/999', '#/series/999', '#/codex/999', '#/nonsense', '#/notes/999']:
            await page.goto(B + h); await page.wait_for_timeout(700)
            txt = (await ev("document.querySelector('#app').innerText")).replace('\n', ' | ')[:120]
            has_way = await ev("!!document.querySelector('#app a[href], #app .bottom-nav')")
            print('     ', h, '→', txt, '| way out:', has_way)
            if not has_way: issues.append(('no way out on ' + h, txt))

        print('\n-- 9 codex entry links')
        await ev("""import('./js/db.js').then(async d => {
            await d.putCodexEntry({ seriesId: 1, name: 'Winston', type: 'character', fields: [] });
        })""")
        await page.goto(B + '#/series/1'); await page.wait_for_timeout(500)
        await page.click('[data-tab="codex"]'); await page.wait_for_timeout(500)
        link = await page.query_selector('a[href^="#/codex/"]')
        if link:
            await link.click(); w = await check('codex entry')
            await page.click('a[data-back]'); await check('codex entry back arrow', h_codex)
        else:
            print('      (no codex entries to open)')


        print('\n-- 10 sheets opened from sheets: back returns to the one below')
        async def seen():
            await page.wait_for_timeout(400)
            return await ev("""() => { const s = document.querySelector('.sheet'); if (!s) return 'none';
                return (s.querySelector('h2, .nc-big, [data-sa]')?.textContent || s.innerText).trim().slice(0, 30); }""")
        async def expect(label, want_contains):
            got = await seen(); ok = (want_contains == 'none' and got == 'none') or (want_contains != 'none' and want_contains in got)
            print(('ok   ' if ok else 'ISSUE'), label, '→', got)
            if not ok: issues.append((label, got))
        await page.goto(B + '#/series/1'); await page.wait_for_timeout(500)
        await page.click('[data-action="series-menu"] >> nth=0'); menu = await seen(); print('      menu:', menu)
        await page.click('[data-sa="rename"]'); await expect('rename sheet', 'ename')
        await page.go_back(); await expect('[phone back] rename → menu', menu[:10])
        await page.go_back(); await expect('[phone back] menu → closed', 'none')
        await check('still on series page', '#/series/1', False)
        await ev("""import('./js/db.js').then(d => d.putNote({ seriesId: 1, chapterId: 1, sp: null, quote: '', text: 'Chapter thought', tagIds: [], createdAt: 5, updatedAt: 5 }))""")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]')
        await ev("document.body.classList.add('controls-open')"); await page.wait_for_timeout(350)
        cn = await page.query_selector('[data-action="chapter-notes"]')
        if cn and await cn.is_visible():
            await cn.click(); await expect('chapter notes', 'Notes in this chapter')
            await page.click('.sheet [data-note-id]'); await expect('note card', '')
            await page.click('[data-nc="edit"]'); await page.wait_for_timeout(300)
            await page.click('[data-ne="cancel"]'); await expect('editor Cancel → note card', 'Edit')
            await page.go_back(); await expect('[phone back] note card → chapter notes', 'Notes in this chapter')
            await page.go_back(); await expect('[phone back] chapter notes → closed', 'none')
            await check('reader after sheets', '#/read/1', False)
        else:
            issues.append(('chapter notes button not visible', None))
        await page.screenshot(path=f'{SH}/t08-end.png')
        print('\nISSUES:', len(issues))
        for i in issues: print('  -', i)
        print('errors:', errs)
        await b.close()

asyncio.run(main())
