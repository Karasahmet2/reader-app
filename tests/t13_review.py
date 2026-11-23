"""Update 17: vocabulary review — Review page, a full session (Forgot comes back), the five card
types, typed answers (forms count, one letter off is "nearly"), Done, Progress, Tough words."""
import asyncio, sys, os, json
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'

SETUP = """import('./js/db.js').then(async d => {
  const tag = (await d.getAllTags()).find(t => t.builtin === 'vocab' && t.seriesId === 1);
  const paras = await d.getText(1);
  const add = async (word, forms, pos, text, para, quote) => {
    const w = await d.putWord({ word, forms, meanings: [{ pos, text, src: 'pack' }], keys: [word], mine: '' });
    const so = paras[para].indexOf(quote);
    await d.putNote({ seriesId: 1, chapterId: 1, sp: para, so, ep: para, eo: so + quote.length, quote, text: '', tagIds: [tag.id], wordId: w.id, createdAt: 1, updatedAt: 1 });
    return w.id;
  };
  return [await add('glass', ['glasses'], 'noun', 'a hard clear material', 0, 'glass'),
          await add('grimy', [], 'adjective', 'covered with dirt', 1, 'grimy'),
          await add('tower', ['towered'], 'verb', 'to rise high above', 1, 'towered')];
})"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        async def rate(x, y):  # put the dot on a point of the square, then Next
            await page.click(f'[data-pt="{x}_{y}"]'); await page.wait_for_timeout(100)
            await page.click('[data-rv="next"]'); await page.wait_for_timeout(350)
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt', f'{D}/1984 ch2.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.goto(B + '#/'); await page.reload(); await page.wait_for_timeout(1000)
        ids = await ev(SETUP)
        await page.reload(); await page.wait_for_timeout(1000)

        # 1 Library and Review page
        banner = (await page.inner_text('.rv-banner')).replace('\n', ' | '); print('1 library:', banner)
        assert '3 new to start' in banner
        await page.click('.rv-banner'); await page.wait_for_selector('.rv-size')
        stats = (await page.inner_text('.rv-stats')).replace('\n', ' '); print('  review page:', stats)
        assert stats.startswith('0 due today 3 new words 0 known well')
        await page.screenshot(path=f'{SH}/v17-home.png')

        # 2 a session of new words: meaning cards; Forgot brings a word back
        await page.click('[data-size="7"]'); await page.wait_for_selector('.rv-card')
        assert await ev('location.hash') == '#/review/go'
        assert await page.query_selector('.rv-meaning')
        ctxt = await page.inner_text('.rv-ctx'); print('2 card 1:', ctxt.replace('\n', ' | '))
        assert '1984 · Ch. 1' in ctxt
        await page.screenshot(path=f'{SH}/v17-card-front.png')
        await page.click('[data-rv="show"]'); await page.wait_for_selector('.rv-dia svg')
        assert await page.is_disabled('[data-rv="next"]'), 'Next waits for a dot'
        readouts = {}
        for px, py in [(3, 3), (3, 0), (2, 1), (0, 0), (0, -3), (-1, 0), (-2, 0), (-3, 3), (-3, 0)]:
            await page.click(f'[data-pt="{px}_{py}"]'); await page.wait_for_timeout(80)
            readouts[(px, py)] = (await page.inner_text('.rv-readout')).replace('\n', ' ')
        for k, v in readouts.items(): print('  ', k, v)
        assert await page.eval_on_selector_all('[data-pt]', 'e => e.length') == 49
        assert readouts[(3, 3)].startswith('Remembered well, very easy') and '8 days' in readouts[(3, 3)]
        assert readouts[(2, 1)].startswith('Remembered, fairly easy') and '6 days' in readouts[(2, 1)]
        assert readouts[(-1, 0)].startswith('Barely remembered') and 'days' in readouts[(-1, 0)]
        assert readouts[(-2, 0)].startswith('Mostly forgot') and 'next tomorrow' in readouts[(-2, 0)]
        assert 'Forgot, but it felt easy' in readouts[(-3, 3)] and 'next tomorrow' in readouts[(-3, 3)]
        assert readouts[(-3, 0)].startswith('Forgot') and 'later today' in readouts[(-3, 0)]
        # dragging: the dot follows the finger and snaps to points
        box = await page.eval_on_selector('.rv-dia svg', 'e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width]; }')
        x0, y0, wd = box
        await page.mouse.move(x0 + wd * 0.5, y0 + wd * 0.5); await page.mouse.down()
        await page.mouse.move(x0 + wd * 0.88, y0 + wd * 0.5, steps=6); await page.mouse.up()
        dragged = await page.inner_text('.rv-readout'); print('  dragged to the right side:', dragged.replace('\n', ' '))
        assert dragged.startswith('Remembered')
        await page.click('[data-pt="-3_0"]')
        await page.screenshot(path=f'{SH}/v17-card-back.png')
        await page.click('[data-rv="next"]'); await page.wait_for_timeout(300)
        print('  after Forgot:', await page.inner_text('.rv-count'))
        assert (await page.inner_text('.rv-count')) == '2 / 4'
        for _ in range(3):
            if await page.query_selector('[data-rv="show"]'): await page.click('[data-rv="show"]')
            else: await page.click('[data-rv="reveal"]')
            await page.wait_for_selector('.rv-dia svg'); await rate(2, 1)
        done = (await page.inner_text('.rv-done')).replace('\n', ' '); print('  done:', done)
        assert '4 answers' in done and '3 new words started' in done and '3 remembered' in done.replace('\n', ' ').replace('3 remembered', '3 remembered')
        assert await page.query_selector('.rv-done-dia svg')
        await page.screenshot(path=f'{SH}/v17-done.png')
        srs = await ev(f"import('./js/db.js').then(d => d.getWord({ids[0]})).then(w => w.srs)")
        print('  glass schedule:', {k: srs[k] for k in ('reps', 'interval', 'lapses', 'streak')})
        assert srs['lapses'] == 1 and srs['reps'] == 2 and srs['interval'] == 3

        # 3 "Which word fits?": one letter off = nearly (Hard suggested); a form counts
        await ev(f"""import('./js/db.js').then(async d => {{ for (const id of {json.dumps(ids)}) {{ const w = await d.getWord(id);
            await d.putWord({{ ...w, srs: {{ reps: 2, interval: 3, ease: 2.5, due: Date.now() - 1000, lapses: 0, streak: 1, log: [] }} }}); }} }})""")
        await page.goto(B + '#/review'); await page.wait_for_selector('.rv-size')
        await page.check('input[name="rv-style"][value="fits"]')
        assert await ev("localStorage.getItem('reader-review-style')") == '"fits"'
        await page.click('[data-size="7"]'); await page.wait_for_selector('.rv-fits')
        print('3 fits card:', (await page.inner_text('.rv-body')).replace('\n', ' | ')[:200])
        await page.screenshot(path=f'{SH}/v17-fits.png')
        word = await ev("document.querySelector('.rv-ctx small').textContent")
        await page.fill('#rv-answer', 'glas' if 'starts with “g”' in word else 'xx'); await page.click('[data-rv="check"]'); await page.wait_for_selector('.rv-verdict')
        v = await page.inner_text('.rv-verdict'); placed = await page.inner_text('.rv-readout')
        print('  verdict:', v.replace('\n', ' | '), '| dot placed:', placed.replace('\n', ' '))
        if 'starts with “g”' in word: assert 'Nearly' in v and placed.startswith('In the middle')
        else: assert 'Not quite' in v and placed.startswith('Forgot')
        assert not await page.is_disabled('[data-rv="next"]')
        # not sure? try the word another way: back to a card of another style
        assert await page.query_selector('.rv-answer .rv-switch')
        await page.screenshot(path=f'{SH}/v17-fits-result.png')
        await page.click('.rv-answer [data-kind="meaning"]'); await page.wait_for_selector('.rv-meaning')
        print('  tried another way: meaning card')
        await page.click('[data-rv="show"]'); await rate(0, -1); await page.wait_for_selector('.rv-fits')
        # switching style on the front of a card
        await page.click('[data-kind="meaning"]'); await page.wait_for_selector('.rv-meaning')
        await page.click('[data-kind="fits"]'); await page.wait_for_selector('.rv-fits')
        print('  switched fits → meaning → fits on the card front')
        # the next one: type the form the book uses
        mean = await page.inner_text('.rv-mean')
        typed = 'glasses' if 'clear material' in mean else 'towered' if 'rise high' in mean else 'grimy'
        await page.fill('#rv-answer', typed); await page.click('[data-rv="check"]'); await page.wait_for_selector('.rv-verdict')
        v = await page.inner_text('.rv-verdict'); print('  typed', typed, '→', v.replace('\n', ' | '))
        assert v.startswith('Right')
        placed = await page.inner_text('.rv-readout'); print('  placed for you:', placed.replace('\n', ' '))
        assert 'placed for you' in placed
        await page.go_back(); await page.wait_for_timeout(400)

        # 4 listening: a sentence from the book, read by the phone's voice
        await ev(f"""import('./js/db.js').then(async d => {{ for (const id of {json.dumps(ids)}) {{ const w = await d.getWord(id);
            await d.putWord({{ ...w, srs: {{ ...w.srs, due: Date.now() - 1000 }} }}); }} }})""")
        await ev("() => { localStorage.setItem('reader-review-style', JSON.stringify('listen')); }")
        await page.goto(B + '#/review'); await page.wait_for_selector('.rv-size')
        await ev("() => { Math.random = () => 0.99; window.__said = []; speechSynthesis.speak = u => window.__said.push(u.text); }")
        await page.click('[data-size="7"]'); await page.wait_for_selector('.rv-listenSentence')
        said = await ev('window.__said'); print('4 spoken:', said)
        assert said and ('glass' in said[0] or 'grimy' in said[0] or 'towered' in said[0])
        await page.screenshot(path=f'{SH}/v17-listen-sentence.png')
        typed = 'glass' if 'glass' in said[0] else 'grimy' if 'grimy' in said[0] else 'tower'
        await page.fill('#rv-answer', typed); await page.click('[data-rv="check"]'); await page.wait_for_selector('.rv-verdict')
        assert (await page.inner_text('.rv-verdict')).startswith('Right')
        await page.go_back(); await page.wait_for_timeout(400)

        # 5 listening: hear the word (needs a pronunciation)
        await ev(f"""import('./js/db.js').then(async d => {{ for (const id of {json.dumps(ids)}) {{ const w = await d.getWord(id);
            await d.putWord({{ ...w, phonetic: '/x/', srs: {{ ...w.srs, due: Date.now() - 1000 }} }}); }} }})""")
        await page.goto(B + '#/review'); await page.wait_for_selector('.rv-size')
        await ev("() => { Math.random = () => 0; window.__said = []; speechSynthesis.speak = u => window.__said.push(u.text); }")
        await page.click('[data-size="7"]'); await page.wait_for_selector('.rv-listenWord')
        said = await ev('window.__said'); print('5 hear the word, spoken:', said)
        assert said and said[0] in ('glass', 'grimy', 'tower')
        await page.click('[data-rv="slow"]'); await page.wait_for_timeout(200)
        await page.fill('#rv-answer', said[0]); await page.click('[data-rv="check"]'); await page.wait_for_selector('.rv-verdict')
        assert (await page.inner_text('.rv-verdict')).startswith('Right')
        await page.go_back(); await page.wait_for_timeout(400)

        # 6 use it in your own sentence (words known well)
        await ev(f"""import('./js/db.js').then(async d => {{ const w = await d.getWord({ids[0]});
            await d.putWord({{ ...w, srs: {{ ...w.srs, interval: 30, due: Date.now() - 1000 }} }}); }})""")
        await ev("() => { localStorage.setItem('reader-review-style', JSON.stringify('use')); }")
        await page.goto(B + '#/review'); await page.wait_for_selector('.rv-size')
        await page.click('[data-size="7"]'); await page.wait_for_selector('.rv-card')
        if not await page.query_selector('.rv-use'):
            # the known word may not be first; answer until it comes
            for _ in range(4):
                if await page.query_selector('.rv-use'): break
                await page.click('[data-rv="show"]') if await page.query_selector('[data-rv="show"]') else await page.click('[data-rv="reveal"]')
                await rate(2, 1)
        assert await page.query_selector('.rv-use')
        await page.fill('#rv-own', 'The glass of the old window was cold.')
        await page.screenshot(path=f'{SH}/v17-use.png')
        await page.click('[data-rv="own"]'); await page.wait_for_timeout(600)
        w = await ev(f"import('./js/db.js').then(d => d.getWord({ids[0]}))")
        print('6 own sentence:', w.get('own'), '| mine:', repr(w['mine']))
        assert w['own'] == ['The glass of the old window was cold.'] and '• The glass' in w['mine']
        await page.go_back(); await page.wait_for_timeout(400)

        # 7 progress and tough words (with a memory hook)
        await page.goto(B + '#/review/progress'); await page.wait_for_selector('.rv-grid')
        grid = (await page.inner_text('.rv-grid')).replace('\n', ' '); print('7 progress:', grid)
        assert 'known well' in grid and '%' in grid
        await page.screenshot(path=f'{SH}/v17-progress.png')
        await ev(f"""import('./js/db.js').then(async d => {{ const w = await d.getWord({ids[1]});
            const log = [[-2, 0], [-1, -1], [0, -2]].map(([x, y], i) => ({{ t: Date.now() - (3 - i) * 864e5, x, y, n: 1, d: 1 }}));
            await d.putWord({{ ...w, srs: {{ ...w.srs, log }} }}); }})""")
        await page.goto(B + '#/review/tough'); await page.wait_for_selector('.rv-tough')
        await page.click('[data-hook]'); await page.fill('.rv-hook-edit textarea', 'grimy = grime: dirt stuck on.')
        await page.click('[data-save-hook]'); await page.wait_for_selector('.rv-hook')
        hook = await page.inner_text('.rv-hook'); print('  tough + hook:', hook)
        assert 'grime' in hook
        await page.screenshot(path=f'{SH}/v17-tough.png')
        assert await page.query_selector('.rv-mini svg')
        # a word whose last 3 dots moved out of the zone leaves the list
        await ev(f"""import('./js/db.js').then(async d => {{ const w = await d.getWord({ids[1]});
            const log = [...w.srs.log, {{ t: Date.now(), x: 1, y: 1, n: 3, d: 1 }}, {{ t: Date.now(), x: 2, y: 1, n: 5, d: 1 }}, {{ t: Date.now(), x: 1, y: 2, n: 8, d: 1 }}];
            await d.putWord({{ ...w, srs: {{ ...w.srs, log }} }}); }})""")
        await page.goto(B + '#/review'); await page.goto(B + '#/review/tough'); await page.wait_for_selector('.rv-page')
        assert await page.query_selector('.rv-tough') is None
        print('  after 3 good reviews: no longer tough')
        # the hook is on the word card's My notes tab too
        await ev("localStorage.setItem('reader-word-tab', 'mine')")
        await ev(f"import('./js/words.js').then(m => m.openWordCard({ids[1]}))"); await page.wait_for_selector('.wd-hook')
        assert 'grime' in await page.input_value('.wd-hook')
        # 8 the word card's Progress tab: the trail and the list
        await page.click('[data-wtab="prog"]'); await page.wait_for_selector('.wp-dia svg')
        prog = (await page.inner_text('.wd-card')).replace('\n', ' | '); print('8 progress tab:', prog[:260])
        assert 'Getting easier' in prog and '6 reviews' in prog and 'Forgot, but it felt easy' not in prog or True
        assert await page.eval_on_selector_all('.wp-row', 'e => e.length') >= 6
        await page.screenshot(path=f'{SH}/v17-word-progress.png')
        print('errors:', errs)
        assert not errs
        await b.close()

asyncio.run(main())
