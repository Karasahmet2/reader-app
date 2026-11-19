"""Update 15: Vocabulary as words — built-in tag, old notes converted, same-word detection,
word card (Dictionary / My notes / places), forms, attach/detach, met-again dots, words list, trash."""
import asyncio, sys, os, json
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'
SEL = """(text) => { for(const p of document.querySelectorAll('#text p[data-p]')){ const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf(text); if(i>=0){ p.scrollIntoView({block:'center'}); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+text.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } } }"""
J = lambda x: json.dumps(x, ensure_ascii=False)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt', f'{D}/1984 ch3.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        # Old-style data: a tag called "Vocab" and a vocabulary note with meanings + own text.
        await ev("""import('./js/db.js').then(async d => {
            const t = await d.addTag('Vocab', 'blue', 1);
            const ps = ['Winston Smith slipped quickly through the glass doors of Victory Mansions.', 'Outside, the Ministry of Truth towered over the grimy landscape.'];
            const so = ps[1].indexOf('grimy');
            await d.putNote({ seriesId: 1, chapterId: 1, sp: 1, so, ep: 1, eo: so + 5, quote: 'grimy', text: 'adjective — covered with dirt\\nI like this word', tagIds: [t.id], createdAt: 1, updatedAt: 1 });
            await d.putWord({ word: 'slip', forms: [], meanings: [{ pos: 'verb', text: 'to slide', src: 'pack' }], keys: ['slip'] });
            await d.putWord({ word: 'party', forms: [], meanings: [], keys: ['party'] });
            const k1 = await d.putWord({ word: 'knock', forms: [], meanings: [{ pos: 'verb', text: 'to hit a door', src: 'pack' }], keys: ['knock'] });
            const k2 = await d.putWord({ word: 'knocked', forms: [], meanings: [{ pos: 'verb', text: 'knocked about', src: 'pack' }], keys: ['knocked'] });
            await d.putNote({ seriesId: 1, chapterId: 3, sp: 0, so: 11, ep: 0, eo: 18, quote: 'knocked', text: '', tagIds: [t.id], wordId: k2.id, createdAt: 2, updatedAt: 2 });
            window.__k = [k1.id, k2.id];
        })""")
        await page.goto(B + '#/'); await page.reload(); await page.wait_for_timeout(1200)  # migrations run at start

        # 1 built-in tag + conversion of the old note
        tags = await ev("import('./js/db.js').then(d => d.getAllTags()).then(l => l.map(t => [t.name, t.seriesId, t.builtin || null]))")
        print('1 tags:', tags)
        assert ['Vocabulary', 1, 'vocab'] in tags
        w = await ev("import('./js/db.js').then(async d => { const n = (await d.getAllNotes()).find(x => x.quote === 'grimy'); const w = await d.getWord(n.wordId); return { word: w.word, meanings: w.meanings, mine: w.mine }; })")
        print('  converted:', J(w))
        assert w['word'] == 'grimy' and w['meanings'][0]['pos'] == 'adjective' and w['mine'] == 'I like this word'

        # 2 Tags tab: Vocabulary first, fixed
        await page.goto(B + '#/series/1/tags'); await page.wait_for_selector('.tags-tab')
        first = (await page.inner_text('.tags-row >> nth=0')).replace('\n', ' | ')
        print('2 tags tab first row:', first)
        assert 'Built in' in first
        await page.click('.tags-row >> nth=0'); await page.wait_for_selector('.tag-editor')
        print('  built-in editor has name field?', await page.query_selector('#tag-name') is not None, '| delete?', await page.query_selector('[data-te="delete"]') is not None)
        assert await page.query_selector('#tag-name') is None
        await page.screenshot(path=f'{SH}/u17-tag.png')
        await page.go_back(); await page.wait_for_timeout(300)

        # 3 reader: saved spot vs met-again dots
        await ev("import('./js/dictionary.js').then(d => d.downloadPack(() => {}))")
        await ev("localStorage.setItem('reader-define-tab', 'pack')")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(800)
        met = await page.eval_on_selector_all('span.wd-met', 'e => e.map(x => x.textContent)')
        grimy = await page.eval_on_selector('mark.note-mark', 'm => [m.textContent, m.dataset.word || null, !!m.querySelector(".wd-met")]')
        print('3 met dots:', met, '| saved spot:', grimy)
        assert 'Party' in met and grimy[1] and not grimy[2]
        await page.screenshot(path=f'{SH}/u17-reader.png')

        # 4 Define "slipped" → same word as "slip"
        assert await ev(SEL, 'slipped')
        await page.wait_for_timeout(400); await page.click('[data-sel="define"]')
        await page.wait_for_selector('.def-sense', timeout=20000)
        await page.click('.def-sense >> nth=0')
        await page.click('[data-def="note"]'); await page.wait_for_selector('.wd-save')
        box = (await page.inner_text('.wd-save')).replace('\n', ' | ')
        print('4 save sheet:', box[:260])
        assert 'Same word as “slip”' in box
        await page.screenshot(path=f'{SH}/u17-same.png')
        await page.click('[data-wd="add"]'); await page.wait_for_timeout(700)
        slip = await ev("import('./js/db.js').then(d => d.getAllWords()).then(l => l.find(w => w.word === 'slip'))")
        print('  slip now:', J({k: slip[k] for k in ('forms', 'meanings')}))
        assert 'slipped' in slip['forms'] and len(slip['meanings']) >= 2
        note = await ev("import('./js/db.js').then(d => d.getAllNotes()).then(l => l.find(n => n.quote === 'slipped'))")
        assert note['wordId'] == slip['id']

        # 5 word card: Dictionary first, My notes, places
        await ev("localStorage.removeItem('reader-word-tab')")
        await page.evaluate("document.querySelector('mark.note-mark[data-word]').click()")
        await page.wait_for_selector('.wd-card')
        card = (await page.inner_text('.wd-card')).replace('\n', ' | ')
        print('5 word card:', card[:240])
        assert 'Dictionary' in card and 'where you met it' in card.lower()
        await page.screenshot(path=f'{SH}/u17-card.png')
        await page.click('[data-wtab="mine"]'); await page.wait_for_selector('.wd-mine')
        print('  my notes:', await page.input_value('.wd-mine'))
        await page.fill('.wd-mine', 'edited note'); await page.wait_for_timeout(700)
        await page.click('[data-wtab="dict"]')
        await page.go_back(); await page.wait_for_timeout(300)

        # 6 eye panel: switch the met-again dots off
        await ev("document.querySelector('.vis-btn').click()"); await page.wait_for_selector('.vis-box')
        panel = (await page.inner_text('.vis-box')).replace('\n', ' | ')
        print('6 panel:', panel[:220])
        assert 'Saved words met again' in panel
        await page.click('input[data-met]'); await page.wait_for_timeout(400)
        print('  dots after off:', await page.eval_on_selector_all('span.wd-met', 'e => e.length'))
        assert await page.eval_on_selector_all('span.wd-met', 'e => e.length') == 0
        await page.click('input[data-met]'); await page.wait_for_timeout(300)
        await page.go_back(); await page.wait_for_timeout(300)

        # 7 attach "knocked" to "knock", then detach
        res = await ev("""Promise.all([import('./js/words.js'), import('./js/db.js')]).then(async ([w, d]) => {
            const [k1, k2] = window.__k || (await d.getAllWords()).filter(x => x.word.startsWith('knock')).map(x => x.id);
            const t = await w.merge(k2, k1);
            const n = (await d.getAllNotes()).find(x => x.quote === 'knocked');
            const after = { forms: t.forms, noteWord: n.wordId === k1, gone: !(await d.getWord(k2)) };
            await w.detach(k1, 0);
            const n2 = (await d.getAllNotes()).find(x => x.quote === 'knocked');
            return { after, back: !!(await d.getWord(k2)), noteBack: n2.wordId === k2, forms: (await d.getWord(k1)).forms };
        })""")
        print('7 attach/detach:', res)
        assert res['after']['noteWord'] and res['after']['gone'] and res['back'] and res['noteBack'] and res['forms'] == []

        # 8 words list with a series filter
        await page.goto(B + '#/notes'); await page.wait_for_timeout(500)
        await page.click('a.notes-words'); await page.wait_for_selector('.words-list')
        rows = await page.eval_on_selector_all('.word-row b', 'e => e.map(x => x.innerText)')
        print('8 words:', rows, '|', await page.inner_text('#wl-count'))
        await page.screenshot(path=f'{SH}/u17-words.png')
        await page.click('[data-wl="series"]'); await page.click('[data-pick-series="1"]'); await page.wait_for_timeout(400)
        only = await page.eval_on_selector_all('.word-row b', 'e => e.map(x => x.innerText)')
        print('  only 1984:', only, '|', await page.inner_text('#wl-count'))
        assert 'party' not in only and 'grimy' in only   # party has no places
        await page.fill('#wl-q', 'slipp'); await page.wait_for_timeout(200)
        print('  search "slipp":', await page.eval_on_selector_all('.word-row b', 'e => e.map(x => x.innerText)'))

        # 9 trash a word (and its places), then undo
        await page.fill('#wl-q', '')
        await page.click('.word-row:has-text("grimy")'); await page.wait_for_selector('.wd-card')
        await page.click('[data-wc="edit"]'); await page.wait_for_selector('.we-box')
        await page.screenshot(path=f'{SH}/u17-edit.png')
        await page.click('[data-we="delete"]'); await page.wait_for_timeout(700)
        gone = await ev("import('./js/db.js').then(async d => [!!(await d.getAllWords()).find(w => w.word === 'grimy'), (await d.getAllNotes()).some(n => n.quote === 'grimy')])")
        print('9 after delete (word, note):', gone, '|', await page.inner_text('#toast'))
        await page.click('#toast button'); await page.wait_for_timeout(700)
        back = await ev("import('./js/db.js').then(async d => [!!(await d.getAllWords()).find(w => w.word === 'grimy'), (await d.getAllNotes()).some(n => n.quote === 'grimy')])")
        print('  after undo:', back)
        assert gone == [False, False] and back == [True, True]
        print('errors:', errs)
        await b.close()

asyncio.run(main())
