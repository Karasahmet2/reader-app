"""Update 14: tick meanings in Define, notes inside notes (stacked lines + chooser), settings in the backup."""
import asyncio, sys, os, json
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'
SEL = """(text) => { for(const p of document.querySelectorAll('#text p[data-p]')){ const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf(text); if(i>=0){ p.scrollIntoView({block:'center'}); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+text.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } } }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt', f'{D}/1984 ch3.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)

        # ---- 1. tick meanings (offline WordNet tab, so no internet is needed)
        await page.evaluate("import('./js/dictionary.js').then(d => d.downloadPack(() => {}))")
        await page.evaluate("localStorage.setItem('reader-define-tab', 'pack')")
        await page.evaluate("""import('./js/db.js').then(d => d.addTag('Vocabulary', 'blue', 1))""")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(600)
        word = 'glass'
        assert await page.evaluate(SEL, word), 'word not in chapter'
        await page.wait_for_timeout(400); await page.click('[data-sel="define"]')
        await page.wait_for_selector('.def-sense', timeout=20000)
        senses = await page.eval_on_selector_all('.def-sense', 'e => e.length'); print('1 senses shown:', senses)
        assert senses >= 2
        print('  button before:', (await page.inner_text('[data-def="note"]')).replace('\n', ' '))
        await page.click('.def-sense >> nth=0'); await page.click('.def-sense >> nth=2')
        label = (await page.inner_text('[data-def="note"]')).replace('\n', ' ')
        print('  button after 2 ticks:', label, '| tab:', await page.inner_text('.def-tabs [aria-selected="true"] small'))
        assert 'Save 2 meanings' in label
        if await page.query_selector('[data-pickex]'):
            await page.click('[data-pickex] >> nth=0')
        await page.screenshot(path=f'{SH}/u16-define.png')
        await page.click('[data-def="note"]'); await page.wait_for_selector('.wd-save')
        sheet = await page.inner_text('.wd-save'); print('  save sheet:', sheet.replace('\n', ' | ')[:200])
        assert await page.eval_on_selector_all('.wd-dict li', 'e => e.length') == 2
        await page.screenshot(path=f'{SH}/u16-note.png')
        await page.click('[data-wd="new"]'); await page.wait_for_timeout(600)
        txt = await page.evaluate("import('./js/db.js').then(d => d.getAllNotes()).then(l => l.find(n => n.quote === 'glass').text)")
        print('  note text:', txt.replace('\n', ' / '))
        assert txt.count(' — ') == 2

        # ---- 2. a sentence note around the word note
        sentence = 'Winston Smith slipped quickly through the glass doors of Victory Mansions.'
        await page.evaluate("""(q) => import('./js/db.js').then(async d => {
            const t = await d.addTag('Plot', 'red', 1);
            const ps = [...document.querySelectorAll('#text p[data-p]')];
            const i = ps.findIndex(p => p.textContent.includes(q)); const so = ps[i].textContent.indexOf(q);
            await d.putNote({ seriesId: 1, chapterId: 1, sp: i, so, ep: i, eo: so + q.length, quote: q, text: 'Opening line', tagIds: [t.id], createdAt: 5, updatedAt: 5 });
        })""", sentence)
        await page.reload(); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(700)
        depths = await page.eval_on_selector_all('mark.note-mark', "e => e.map(m => [m.textContent.slice(0, 20), m.dataset.depth || '0', getComputedStyle(m).textUnderlineOffset])")
        print('2 marks:', depths)
        inner = [d for d in depths if d[1] == '1']
        assert inner and inner[0][0].startswith(word), 'word mark should sit inside the sentence mark'
        await page.evaluate(f"document.querySelector('mark.note-mark[data-depth=\"1\"]').scrollIntoView({{block:'center'}})")
        await page.screenshot(path=f'{SH}/u16-stacked.png')
        await page.evaluate("document.querySelector('mark.note-mark[data-depth=\"1\"]').click()"); await page.wait_for_selector('.here-list')
        rows = await page.eval_on_selector_all('.here-row b', 'e => e.map(x => x.innerText)'); print('  chooser:', rows)
        assert len(rows) == 2
        await page.screenshot(path=f'{SH}/u16-chooser.png')
        await page.click('.here-row >> nth=1'); await page.wait_for_timeout(500)
        card = await page.inner_text('.sheet'); print('  picked →', card.replace('\n', ' | ')[:80])
        assert 'Opening line' in card
        await page.go_back(); await page.wait_for_timeout(400)
        print('  state after closing:', await page.evaluate('JSON.stringify(history.state)'), await page.is_visible('.sheet'))
        # tapping the sentence outside the word opens it straight away
        await page.evaluate("[...document.querySelectorAll('mark.note-mark')].find(m => !m.dataset.depth && m.querySelector('mark')).click()")
        await page.wait_for_timeout(400)
        print('  outside the word → chooser?', await page.is_visible('.here-list'))
        assert not await page.is_visible('.here-list')
        await page.go_back(); await page.wait_for_timeout(300)

        # ---- 3. backup: settings + per-series choices, keys switch, restore options
        await page.evaluate("""() => {
            const s = JSON.parse(localStorage.getItem('reader-settings') || '{}');
            Object.assign(s, { theme: 'paper', mwLearnersKey: 'KEY-L', mwCollegiateKey: 'KEY-C', backupKeys: false });
            localStorage.setItem('reader-settings', JSON.stringify(s));
            localStorage.setItem('reader-hidden-tags', JSON.stringify({ 1: { tags: [2], highlights: false } }));
            localStorage.setItem('reader-codex-view', JSON.stringify({ 1: { rooms: ['character'], sort: 'appear' } }));
        }""")
        await page.goto(B + '#/backup'); await page.reload(); await page.wait_for_timeout(600)
        print('3 backup page:', (await page.inner_text('.included')).replace('\n', ' | ')[:220])
        await page.screenshot(path=f'{SH}/u16-backup.png', full_page=True)
        info = await page.evaluate("""() => Promise.all([import('./js/backup.js'), import('./js/settings.js')]).then(async ([bk, st]) => {
            const f = await bk.createBackup(st.loadSettings());
            let text;
            try { text = await new Response(f.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text(); } catch { text = await f.blob.text(); }
            const j = JSON.parse(text);
            window.__bk = j;
            return { theme: j.settings.theme, keyL: j.settings.mwLearnersKey || null, local: Object.keys(j.local || {}) };
        })""")
        print('  backup file has:', info)
        assert info['theme'] == 'paper' and info['keyL'] is None and 'reader-hidden-tags' in info['local']
        # restore with settings but without keys, after changing things locally
        res = await page.evaluate("""() => import('./js/backup.js').then(async bk => {
            localStorage.removeItem('reader-codex-view');
            const cur = { theme: 'dim', mwLearnersKey: 'MINE' };
            const sum = bk.summarize(window.__bk);
            const next = await bk.restoreBackup(window.__bk, { current: cur, settings: true, keys: true });
            return { sum, theme: next.theme, key: next.mwLearnersKey, view: localStorage.getItem('reader-codex-view') };
        })""")
        print('  restore →', res)
        assert res['theme'] == 'paper' and res['key'] == 'MINE' and res['view']
        old = await page.evaluate("""() => import('./js/backup.js').then(async bk => {
            const o = structuredClone(window.__bk); delete o.local; o.settings = {};
            const next = await bk.restoreBackup(o, { current: { theme: 'dim' }, settings: true, keys: true });
            return { sum: bk.summarize(o), theme: next.theme };
        })""")
        print('  old-style backup →', old)
        assert old['theme'] == 'dim' and not old['sum']['hasSettings']
        print('errors:', errs)
        await b.close()

asyncio.run(main())
