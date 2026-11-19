"""Update 16.1: word card icons, Find with all forms, Define with saved meanings ticked
(Update meanings), Forms sheet, "Most saved", and notes always showing the word's meanings."""
import asyncio, sys, os
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.goto(B + '#/'); await page.reload(); await page.wait_for_timeout(1000)
        # A saved word "glass" (+ "glasses") with one meaning from Wiktionary, and its spot in ch1.
        await ev("""import('./js/db.js').then(async d => {
            const tag = (await d.getAllTags()).find(t => t.builtin === 'vocab' && t.seriesId === 1);
            const w = await d.putWord({ word: 'glass', forms: ['glasses'], meanings: [{ pos: 'noun', text: 'my custom meaning', example: '', src: 'wiki' }], mine: 'see-through', keys: ['glass'] });
            const p = 'Winston Smith slipped quickly through the glass doors of Victory Mansions.';
            const so = p.indexOf('glass');
            await d.putNote({ seriesId: 1, chapterId: 1, sp: 1, so, ep: 1, eo: so + 5, quote: 'glass', text: 'old stale text', tagIds: [tag.id], wordId: w.id, createdAt: 1, updatedAt: 1 });
        })""")
        await page.reload(); await page.wait_for_timeout(1200)  # startup brings notes up to date
        t = await ev("import('./js/db.js').then(d => d.getAllNotes()).then(l => l.find(n => n.quote === 'glass').text)")
        print('1 note text after start:', repr(t))
        assert 'my custom meaning' in t and 'see-through' in t and 'stale' not in t

        await ev("import('./js/dictionary.js').then(d => d.downloadPack(() => {}))")
        await ev("localStorage.setItem('reader-define-tab', 'pack')")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(800)

        # 2 card: icons only, no places
        await page.evaluate("document.querySelector('mark.note-mark[data-word]').click()")
        await page.wait_for_selector('.wd-card')
        icons = await page.eval_on_selector_all('.wd-icon', 'e => e.map(x => [x.dataset.wc, x.getAttribute("aria-label"), x.innerText.trim()])')
        print('2 icons:', icons)
        assert [i[0] for i in icons] == ['edit', 'find', 'define', 'attach'] and all(not i[2] for i in icons)
        assert await page.query_selector('.wd-places') is None
        await page.screenshot(path=f'{SH}/v161-card.png')

        # 3 Find: word + all forms; back returns to the card
        await page.click('[data-wc="find"]'); await page.wait_for_selector('.find-sheet')
        await page.wait_for_function("!document.querySelector('.find-results').innerText.includes('Searching')")
        forms = await page.inner_text('.find-forms'); res = (await page.inner_text('.find-results'))[:80].replace('\n', ' | ')
        print('3 find:', forms, '|', res)
        assert 'glasses' in forms and 'use' in res
        await page.screenshot(path=f'{SH}/v161-find.png')
        await page.go_back(); await page.wait_for_timeout(400)
        assert await page.query_selector('.wd-card'), 'back from Find should show the card'

        # 4 Define from the card: saved meaning ticked under "Saved from elsewhere"
        await page.click('[data-wc="define"]'); await page.wait_for_selector('.def-sense', timeout=20000)
        sub = await page.inner_text('.def-head')
        else_ = await page.inner_text('.def-elsewhere')
        btn = (await page.inner_text('[data-def="update"]')).replace('\n', ' ')
        print('4 define:', sub.replace('\n', ' | '), '||', else_.replace('\n', ' | '), '||', btn)
        assert 'Changing the meanings' in sub and 'my custom meaning' in else_ and '+0 new · 0 removed' in btn
        await page.click('[data-pick] >> nth=0')            # add the first offline meaning
        await page.click('.def-elsewhere [data-keep="0"]')  # remove the custom one
        btn = (await page.inner_text('[data-def="update"]')).replace('\n', ' ')
        tabs = await page.inner_text('.def-tabs')
        print('  after ticks:', btn, '| tabs:', tabs.replace('\n', ' '))
        assert '+1 new · 1 removed' in btn
        await page.screenshot(path=f'{SH}/v161-define.png')
        first = await page.eval_on_selector('.is-picked[data-pick] .def-body > span', 'e => e.textContent.trim()')
        await page.click('[data-def="update"]'); await page.wait_for_timeout(800)
        card = await page.inner_text('.wd-card')
        print('  card after update:', card[:160].replace('\n', ' | '))
        assert first[:20] in card and 'my custom meaning' not in card
        t = await ev("import('./js/db.js').then(d => d.getAllNotes()).then(l => l.find(n => n.quote === 'glass').text)")
        print('  note text:', repr(t[:80]))
        assert first[:20] in t and 'my custom' not in t

        # 5 Define again: the new meaning is ticked and marked "saved"
        await page.click('[data-wc="define"]'); await page.wait_for_selector('.def-sense', timeout=20000)
        saved = await page.eval_on_selector_all('.def-sense.is-picked', 'e => e.map(x => x.textContent.trim())')
        print('5 ticked on reopen:', saved)
        assert len(saved) == 1 and 'saved' in saved[0]
        await page.go_back(); await page.wait_for_timeout(400)

        # 6 Forms sheet title, then back to card, then close
        await page.click('[data-wc="edit"]'); await page.wait_for_selector('.we-box')
        h = await page.inner_text('.we-box h2'); print('6 forms sheet:', h)
        assert h.startswith('Forms of')
        await page.go_back(); await page.wait_for_timeout(400)
        assert await page.query_selector('.wd-card')
        await page.go_back(); await page.wait_for_timeout(400)

        # 7 Words list: "Most saved"; Notes page shows the current meanings
        await page.goto(B + '#/words'); await page.wait_for_selector('.words-sort')
        sorts = await page.inner_text('.words-sort'); print('7 sorts:', sorts.replace('\n', ' · '))
        assert 'Most saved' in sorts and 'Most met' not in sorts
        await page.goto(B + '#/notes'); await page.wait_for_timeout(800)
        txt = await page.inner_text('#app')
        assert first[:20] in txt, 'Notes page shows the word meanings'
        print('  notes page shows the new meaning: yes')
        print('errors:', errs)
        await b.close()

asyncio.run(main())
