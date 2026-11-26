"""Update 18: the word list (sort, search, series progress), Define forms you tick to save, and the
flashcard with swipeable sentences and meanings."""
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
  const g = await add('glass', ['glasses'], 'noun', 'a hard clear material', 0, 'glass');
  await add('grimy', [], 'adjective', 'covered with dirt', 1, 'grimy');
  await add('tower', ['towered'], 'verb', 'to rise high above', 1, 'towered');
  const gw = await d.getWord(g);
  await d.putWord({ ...gw, meanings: [...gw.meanings, { pos: 'verb', text: 'to look through a glass', src: 'pack' }] });
  return g;
})"""

WIKI = json.dumps({'word': 'regard', 'entries': [{'language': {'code': 'en'}, 'partOfSpeech': 'verb',
    'senses': [{'definition': 'to look at with a certain attitude', 'examples': ['She regarded him coldly.']}],
    'forms': [{'word': 'regards', 'tags': ['third-person', 'singular']}, {'word': 'regarded', 'tags': ['past']}, {'word': 'regarding', 'tags': ['participle']}]}]})

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        ev = page.evaluate
        await ctx.route('https://freedictionaryapi.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body=WIKI))
        await ctx.route('https://www.dictionaryapi.com/**', lambda r: r.fulfill(status=404, body='{}'))
        await ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))

        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.goto(B + '#/'); await page.reload(); await page.wait_for_timeout(800)
        gid = await ev(SETUP)
        await page.reload(); await page.wait_for_timeout(800)

        # 1 the word list: every word, sortable, searchable
        await ev("localStorage.setItem('reader-review-series','\"all\"')")
        await page.goto(B + '#/review/words'); await page.wait_for_selector('.rv-vrow')
        n = await page.locator('.rv-vrow').count(); print('1 word list rows:', n); assert n == 3
        await page.click('[data-sort="first"]'); await page.wait_for_timeout(150)
        assert await page.inner_text('.rv-sorts .is-on') == 'First met'
        await page.fill('#rv-q', 'gri'); await page.wait_for_timeout(150)
        assert await page.locator('.rv-vrow').count() == 1
        await page.fill('#rv-q', ''); await page.wait_for_timeout(100)

        # 2 one series: where you met each word, and its progress beside it
        await ev("localStorage.setItem('reader-review-series','1')")
        await page.reload(); await page.wait_for_selector('.rv-vrow')
        chips = (await page.inner_text('.rv-vrow .rv-vchips')).replace('\n', ' '); print('2 series row chips:', chips)
        assert 'Ch. 1' in chips
        assert await page.locator('.rv-vprog svg, .rv-vprog .rv-vnew').count() == 3
        await page.screenshot(path=f'{SH}/v18-wordlist.png')

        # 3 Define: Wiktionary forms, tick the ones to save
        await ev("localStorage.setItem('reader-define-tab', 'wiki')")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(500)
        await ev("""() => { const p=document.querySelector('#text p[data-p="0"]'); const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf('glass'); if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+5); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } }""")
        await page.wait_for_timeout(300); await page.click('[data-sel="define"]')
        await page.wait_for_selector('.def-form', timeout=20000)
        forms = await page.locator('.def-form').count(); print('3 forms offered:', forms); assert forms == 3
        await page.click('.def-form [data-form="regarded"]'); await page.wait_for_timeout(150)
        ticked = await page.locator('.def-form.is-on').count(); print('  ticked after untick one:', ticked); assert ticked == 2
        await page.screenshot(path=f'{SH}/v18-define-forms.png')
        await page.click('.def-save-btn'); await page.wait_for_selector('.wd-save', timeout=8000)
        saved_line = await page.inner_text('.wd-save-forms'); print('  save sheet:', saved_line)
        assert 'regarded' not in saved_line and 'regards' in saved_line
        await page.click('[data-wd="new"]'); await page.wait_for_timeout(800)

        # 4 the flashcard: word, forms, sentences and meanings to swipe, notes, then the square
        await ev("localStorage.setItem('reader-review-styles','[\"meaning\"]')")
        await page.goto(B + '#/review'); await page.wait_for_selector('[data-rv="start"]')
        await page.click('[data-rv="start"]'); await page.wait_for_selector('.rv-card.rv-answer', timeout=8000)
        print('4 flashcard shows: forms', await page.locator('.rv-forms .chip').count(), 'carousels', await page.locator('.rv-car').count())
        assert await page.locator('.rv-car').count() >= 1 and await page.locator('.rv-rate').count() == 1
        mean = page.locator('.rv-car[data-car="mean"]')
        if await mean.count():
            assert await mean.locator('[data-car-step="1"]').count() == 1
            await mean.locator('[data-car-step="1"]').click(); await page.wait_for_timeout(100)
            assert (await mean.locator('.rv-car-n').inner_text()) == '2 of 2'
            await mean.locator('[data-car-step="-1"]').click(); await page.wait_for_timeout(100)
            assert (await mean.locator('.rv-car-n').inner_text()) == '1 of 2'
        await page.screenshot(path=f'{SH}/v18-flashcard.png')
        await page.click('[data-rv="next"]', force=True) if await page.locator('[data-rv="next"][disabled]').count() == 0 else None
        print('errors:', errs)
        await b.close()

asyncio.run(main())
