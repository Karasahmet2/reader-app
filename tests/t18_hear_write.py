"""Hear and write: a sentence from the book is read aloud and typed out. The check ignores case,
punctuation and word order's small slips; the practice button is on the Review page."""
import asyncio, sys, os
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; D = f'{S}/fixtures/1984'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(B + '#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input', [f'{D}/1984 ch1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1200)
        # one saved word that appears in the book (so a sentence can be read)
        await page.evaluate("""import('./js/db.js').then(d => d.putWord({ word: 'Party', forms: ['Party', 'Parties'], meanings: [{ pos: 'noun', text: 'the group that rules', src: 'pack' }], keys: ['Party'], mine: '' }))""")
        await page.wait_for_timeout(300)
        await page.goto(B + '#/review'); await page.wait_for_timeout(400)
        kinds = await page.evaluate("[...document.querySelectorAll('.rv-kind')].map(k => k.dataset.style)")
        print('practice kinds:', kinds); assert 'dictate' in kinds, kinds
        ok = await page.evaluate("""async () => {
          const m = await import('/js/review.js');
          return [m.sentenceVerdict('winston thought about the party', 'Winston thought about the Party.'),
                  m.sentenceVerdict('Winston thought about the parties', 'Winston thought about the party.'),
                  m.sentenceVerdict('the cat sat down', 'Winston thought about the party.'),
                  m.sentenceVerdict('', 'Winston thought about the party.')];
        }""")
        print('verdicts:', ok); assert ok == ['right', 'nearly', 'wrong', 'wrong'], ok
        print('errors:', errs); assert not errs
        await b.close()

asyncio.run(main())
