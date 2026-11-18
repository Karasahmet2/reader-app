import asyncio, sys, os
from playwright.async_api import async_playwright
S=sys.argv[1]; B='http://localhost:8765/'; D=f'{S}/fixtures/1984'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME') or None,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        page=await ctx.new_page(); errs=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        await page.goto(B+'#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input',[f'{D}/1984 ch1.txt',f'{D}/1984 ch2.txt',f'{D}/1984 ch3.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.evaluate("""Promise.all([import('./js/db.js'),import('./js/codex.js')]).then(async([d,c])=>{
          const s=(await d.getAllSeries())[0]; await c.applyStructure(s.id,{types:c.PRESETS.novel.types});
          const w=await d.putCodexEntry({seriesId:s.id,type:'character',name:'Winston',aliases:[],since:0,fields:{},about:''});
          await d.putCodexEntry({seriesId:s.id,type:'character',name:'Julia',aliases:[],since:0,fields:{relations:[{id:w.id,label:'friend',since:0}]},about:''});
          const t=await d.addTag('Plot','red',s.id);
          await d.putNote({seriesId:s.id,chapterId:2,sp:0,so:0,ep:0,eo:7,quote:'Winston',text:'',tagIds:[t.id],createdAt:1,updatedAt:1});
          window.__s=s.id; })""")
        sid = 1
        H = lambda: page.evaluate('location.hash')
        async def go(h): await page.goto(B+h); await page.wait_for_timeout(700)
        async def back_arrow(sel='a.icon-btn[aria-label^="Back"]'):
            await page.evaluate(f"document.querySelector('{sel}').click()"); await page.wait_for_timeout(700)
        async def sysback(): await page.go_back(); await page.wait_for_timeout(700)
        async def step(name, *acts):
            out=[]
            for a in acts: await a(); out.append(await H())
            print(f'{name}: ' + ' → '.join(out))
        # A
        await go('#/'); await go(f'#/series/{sid}'); await go('#/read/1')
        await step('A reader ←arrow, then phone back', back_arrow, sysback)
        # B reader → Codex tool → entry → arrow
        await go(f'#/series/{sid}'); await go('#/read/2')
        await page.evaluate("document.querySelector('[data-action=\"reader-codex\"]').click()"); await page.wait_for_timeout(700)
        await page.click('.sheet a.cx-row >> nth=0'); await page.wait_for_timeout(700); print('B opened entry from reader:', await H())
        await step('B entry ←arrow', back_arrow)
        # C entry → linked entry → arrow / phone back
        await go(f'#/series/{sid}/codex'); await go('#/codex/2')
        await page.click('a.cx-lname'); await page.wait_for_timeout(700); print('C went to linked entry:', await H())
        await step('C linked entry ←arrow, then phone back', back_arrow, sysback)
        # D notes page → note → reader → arrow
        await go('#/'); await go('#/notes')
        print('D notes page has back arrow:', await page.evaluate("!!document.querySelector('a.icon-btn[aria-label^=\"Back\"]')"))
        await page.click('.note-card'); await page.wait_for_timeout(500)
        if await page.query_selector('[data-nc="goto"]'): await page.click('[data-nc="goto"]'); await page.wait_for_timeout(800)
        print('D opened note in reader:', await H())
        await step('D reader ←arrow', back_arrow)
        # E series notes tab → note → reader → arrow
        await go(f'#/series/{sid}/notes'); await page.click('.note-card'); await page.wait_for_timeout(500)
        if await page.query_selector('[data-nc="goto"]'): await page.click('[data-nc="goto"]'); await page.wait_for_timeout(800)
        print('E opened from series Notes tab:', await H())
        await step('E reader ←arrow', back_arrow)
        # F settings → backup → arrow → phone back
        await go('#/settings'); await go('#/backup')
        await step('F backup ←arrow, then phone back', back_arrow, sysback)
        # G series scroll: long list? check where series page lands after reader arrow
        # H reader: phone back twice after next chapter
        await go(f'#/series/{sid}'); await go('#/read/1'); await go('#/read/2')
        await step('H ch2 (came via next) phone back', sysback)
        # I series tab switching then phone back
        await go('#/'); await go(f'#/series/{sid}')
        await page.click('.series-tabs button:has-text("Codex")'); await page.wait_for_timeout(500)
        await page.click('.series-tabs button:has-text("Notes")'); await page.wait_for_timeout(500)
        await step('I series tabs then phone back', sysback)
        # J entry back when opened from series Codex tab — and phone back afterwards
        await go('#/'); await go(f'#/series/{sid}'); await page.click('.series-tabs button:has-text("Codex")'); await page.wait_for_timeout(500)
        await page.click('a.cx-row >> nth=0'); await page.wait_for_timeout(600)
        await step('J entry ←arrow, then phone back, phone back', back_arrow, sysback, sysback)
        print('errors', errs); await b.close()
asyncio.run(main())
