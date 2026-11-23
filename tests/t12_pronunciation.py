"""Update 16.4: a saved word keeps its pronunciation — the written one (/ɡlɑːs/) shown on the
word card, the recording kept on the phone, and the phone's own voice when there's no recording."""
import asyncio, sys, os, json
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'; D = f'{S}/fixtures/1984'
SEL = """(text) => { for(const p of document.querySelectorAll('#text p[data-p]')){ const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf(text); if(i>=0){ p.scrollIntoView({block:'center'}); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+text.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } } }"""
WIKI = {'word': 'glass', 'entries': [{'language': {'code': 'en'}, 'partOfSpeech': 'noun',
        'pronunciations': [{'type': 'ipa', 'text': '/ɡlɑːs/', 'tags': ['Received Pronunciation']}, {'type': 'ipa', 'text': '/ɡlæs/', 'tags': ['General American']}],
        'senses': [{'definition': 'A hard, transparent material made by melting sand.'}]}]}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        await ctx.route('https://freedictionaryapi.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(WIKI)))
        await ctx.route('https://media.example.org/**', lambda r: r.fulfill(status=200, content_type='audio/mpeg', body=b'ID3fake'))
        ev = page.evaluate
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await ev("localStorage.setItem('reader-define-tab', 'wiki')")
        await page.goto(B + '#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(800)

        # 1 save "glass" from Wiktionary: the written pronunciation comes along
        assert await ev(SEL, 'glass')
        await page.wait_for_timeout(400); await page.click('[data-sel="define"]')
        await page.wait_for_selector('.def-sense', timeout=20000)
        await page.click('[data-def="note"]'); await page.wait_for_selector('.wd-save')
        await page.click('.wd-save [data-wd="new"]'); await page.wait_for_timeout(900)
        w = await ev("import('./js/db.js').then(d => d.getAllWords()).then(l => l[0])")
        print('1 saved:', w['word'], '|', w.get('phonetic'), '| audio:', repr(w.get('audio')))
        assert w['phonetic'] == 'UK /ɡlɑːs/ · US /ɡlæs/'

        # 2 the card shows it, and the speaker uses the phone's voice (no recording)
        await ev("() => { window.__said = []; speechSynthesis.speak = u => window.__said.push(u.text); }")
        await page.evaluate("document.querySelector('mark.note-mark[data-word]').click()")
        await page.wait_for_selector('.wd-card')
        ipa = await page.inner_text('.wd-ipa'); voice = await page.get_attribute('[data-wc="say"]', 'aria-label')
        await page.click('[data-wc="say"]'); await page.wait_for_timeout(300)
        said = await ev('window.__said')
        print('2 card:', ipa, '|', voice, '| said:', said)
        assert 'ɡlɑːs' in ipa and 'phone voice' in voice and said == ['glass']
        await page.screenshot(path=f'{SH}/v164-card.png')
        await page.go_back(); await page.wait_for_timeout(400)

        # 3 a recording is kept on the phone
        await ev("import('./js/words.js').then(m => m.keepAudio('https://media.example.org/glass.mp3'))")
        kept = await ev("caches.open('reader-audio').then(c => c.match('https://media.example.org/glass.mp3')).then(r => !!r)")
        print('3 recording kept on the phone:', kept); assert kept

        # 4 an older word without one gets it from Define → Update meanings
        await ev("import('./js/db.js').then(async d => { const w = (await d.getAllWords())[0]; await d.putWord({ ...w, phonetic: '' }); })")
        await page.evaluate("document.querySelector('mark.note-mark[data-word]').click()")
        await page.wait_for_selector('.wd-card')
        assert await page.query_selector('.wd-ipa') is None
        await page.click('[data-wc="define"]'); await page.wait_for_selector('.def-sense', timeout=20000)
        await page.click('[data-def="update"]'); await page.wait_for_timeout(800)
        ipa = await page.inner_text('.wd-ipa'); print('4 after Update meanings:', ipa)
        assert 'ɡlæs' in ipa
        print('errors:', errs)
        await b.close()

asyncio.run(main())
