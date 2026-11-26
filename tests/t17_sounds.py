"""Update 18: sounds — only your own sounds (no built-in ones), rename, Pause keeps the place
(Stop clears it), and the sleep timer at the top of the page."""
import asyncio, sys, os, wave, struct, math
from playwright.async_api import async_playwright
S = sys.argv[1]; B = 'http://localhost:8765/'; SH = f'{S}/shots'

def tone(path):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(8000 * 2)))

async def main():
    wav = os.path.join(S, 'fixtures', 'tone.wav'); tone(wav)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'Failed to load' not in m.text and errs.append(m.text))
        await page.goto(B + '#/sounds'); await page.wait_for_selector('.sounds')

        # 1 no built-in sounds; the sleep timer is the first section
        assert await page.locator('.snd-tile').count() == 0; print('1 built-in sounds: none')
        first = (await page.locator('.sounds section').first.inner_text()).split('\n')[0]; print('  first section:', first)
        assert first.lower().startswith('sleep timer')

        # 2 add a sound from the phone
        await page.evaluate("() => { const i = document.querySelector('input[type=file][accept=\"audio/*\"]'); i.dataset.ready = '1'; }")
        await page.click('[data-snd="add"]')
        await page.set_input_files('input[type=file][accept="audio/*"]', wav)
        await page.wait_for_selector('.snd-mine', timeout=8000)
        name = await page.inner_text('.snd-mine-info b'); print('2 added:', name)

        # 3 rename
        await page.click('[data-snd-rename]'); await page.fill('.snd-rename', 'Bell at dusk'); await page.press('.snd-rename', 'Enter')
        await page.wait_for_timeout(300)
        assert await page.inner_text('.snd-mine-info b') == 'Bell at dusk'; print('3 renamed: ok')

        # 4 play, pause keeps the place, stop clears it
        await page.click('[data-snd-toggle]'); await page.wait_for_selector('.snd-now', timeout=5000)
        await page.click('[data-snd-pause]'); await page.wait_for_timeout(200)
        assert await page.locator('.snd-now').count() == 1, 'paused sound stays in Now playing'
        assert 'Paused' in await page.inner_text('.snd-now-top')
        print('4 paused, still listed: ok')
        await page.click('[data-snd-pause]'); await page.wait_for_timeout(200)
        assert 'Playing' in await page.inner_text('.snd-now-top')
        await page.click('[data-snd-stop]'); await page.wait_for_timeout(200)
        assert await page.locator('.snd-now').count() == 0; print('  stopped and removed: ok')
        await page.screenshot(path=f'{SH}/v18-sounds.png')
        print('errors:', errs)
        await b.close()

asyncio.run(main())
