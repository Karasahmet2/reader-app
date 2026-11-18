import asyncio, sys, os
from playwright.async_api import async_playwright
S=sys.argv[1]; B='http://localhost:8765/'; SH=f'{S}/shots'; D=f'{S}/fixtures/1984'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME') or None,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
        page=await ctx.new_page(); errs=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        await page.goto(B+'#/import'); await page.wait_for_selector('.drop-card')
        print('import:', (await page.inner_text('.drop-card')).replace('\n',' | '))
        await page.set_input_files('#file-input',[f'{D}/1984 ch1.txt',f'{D}/1984 ch2.txt',f'{D}/1984 ch3.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.evaluate("""Promise.all([import('./js/db.js'),import('./js/codex.js')]).then(async([d,c])=>{
          await c.applyStructure(1,{types:c.PRESETS.novel.types});
          await d.putCodexEntry({seriesId:1,type:'character',name:'Winston',aliases:[],since:2,fields:{role:[{v:'Records clerk',since:1}]},about:''});
          // old setting off → migration
          const st=JSON.parse(localStorage.getItem('reader-settings')||'{}'); st.codexNames=false; localStorage.setItem('reader-settings',JSON.stringify(st));
        })""")
        await page.goto(B+'#/codex/1'); await page.reload(); await page.wait_for_timeout(900)
        print('hero:', await page.inner_text('.cx-hero small'), '| link', await page.get_attribute('.cx-chlink','href'))
        print('migrated: rooms hidden', await page.evaluate("localStorage.getItem('reader-hidden-rooms')"), '| codexNames in settings:', await page.evaluate("'codexNames' in JSON.parse(localStorage.getItem('reader-settings'))"))
        await page.screenshot(path=f'{SH}/u15-entry.png')
        print('tip visible:', await page.is_visible('.cx-tip'))
        await page.goto(B+'#/settings'); await page.wait_for_timeout(400)
        await page.click('[data-toggle="showTips"]'); await page.wait_for_timeout(300)
        await page.goto(B+'#/codex/1'); await page.wait_for_timeout(600)
        print('tips off → tip visible:', await page.is_visible('.cx-tip'), '| status still visible ok')
        await page.goto(B+'#/import'); await page.wait_for_timeout(400)
        print('import tip visible:', await page.is_visible('.drop-card .tip'))
        # peek: turn rooms back on, open reader ch2, tap name
        await page.evaluate("localStorage.removeItem('reader-hidden-rooms')")
        await page.goto(B+'#/read/2'); await page.wait_for_timeout(900)
        await page.evaluate("document.querySelector('span.cx-name').click()"); await page.wait_for_selector('.cx-peek')
        print('peek:', (await page.inner_text('.cx-peek')).replace('\n',' | ')[:200])
        await page.screenshot(path=f'{SH}/u15-peek.png')
        await page.click('button.cx-peek-head'); await page.wait_for_timeout(700)
        print('tap name →', await page.evaluate('location.hash'))
        print('errors', errs); await b.close()
asyncio.run(main())
