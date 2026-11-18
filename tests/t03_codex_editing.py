import asyncio, sys, os, json
from playwright.async_api import async_playwright
S=sys.argv[1]; B='http://localhost:8765/'; SH=f'{S}/shots'; D=f'{S}/fixtures/1984'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME') or None,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,reduced_motion='reduce')
        page=await ctx.new_page(); errs=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        page.on('console', lambda m: m.type=='error' and 'Failed to load' not in m.text and errs.append(m.text))
        await page.goto(B+'#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input',[f'{D}/1984 ch1.txt',f'{D}/1984 ch2.txt',f'{D}/1984 ch3.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        await page.evaluate("""Promise.all([import('./js/db.js'),import('./js/codex.js')]).then(async([d,c])=>{
          await c.applyStructure(1,{types:c.PRESETS.novel.types});
          const j=await d.putCodexEntry({seriesId:1,type:'character',name:'Julia',aliases:[],since:2,fields:{},about:''});
          const o=await d.putCodexEntry({seriesId:1,type:'character',name:"Parsons",aliases:[],since:1,fields:{},about:''});
          await d.putCodexEntry({seriesId:1,type:'character',name:'Winston',aliases:['Smith'],since:1,about:'Keeps a diary.',
            fields:{role:[{v:'Records clerk',since:1},{v:'Under suspicion',since:3}],relations:[{id:j.id,label:'lover',since:2},{id:o.id,label:'neighbour',since:1,until:2}]}});
          })""")
        await page.goto(B+'#/'); await page.goto(B+'#/read/3'); await page.wait_for_timeout(800)   # progress = 3
        await page.goto(B+'#/series/1/codex'); await page.wait_for_timeout(500)
        await page.click('a.cx-row:has-text("Winston")'); await page.wait_for_timeout(700)
        txt = lambda sel='main': page.inner_text(sel)
        print('1 entry:', (await txt()).replace('\n',' | ')[:500])
        await page.click('[data-drawer$=":2"]'); await page.wait_for_timeout(400)   # Julia's ▾ (id 1? check)
        print('  drawers open:', await page.eval_on_selector_all('.cx-lrow.is-open .cx-drawer','e=>e.map(x=>x.innerText.replace(/\\n/g," / "))'))
        await page.screenshot(path=f'{SH}/u13-entry.png', full_page=True)
        # viewing as of → picker, type 2
        await page.click('[data-cxa="viewas"]'); await page.wait_for_selector('.cp-sheet')
        await page.screenshot(path=f'{SH}/u13-picker.png')
        await page.fill('#cp-num','2'); await page.press('#cp-num','Enter'); await page.wait_for_timeout(600)
        print('2 as of 2:', (await txt('.cx-viewas')).replace('\n',' | '), '|| relations:', (await page.inner_text('main')).count('Parsons'), 'Parsons mentions')
        print('  past/now:', await page.eval_on_selector_all('.cx-lrow','e=>e.map(x=>x.className+":"+x.innerText.split("\\n")[0])'))
        await page.click('.cx-lname:has-text("Julia")'); await page.wait_for_timeout(600)
        print('  on Julia, view stays:', (await txt('.cx-viewas')).replace('\n',' | '), await page.evaluate('location.hash'))
        await page.click('a[data-back]'); await page.wait_for_timeout(600); print('  back arrow →', await page.evaluate('location.hash'))
        await page.click('[data-cxa="progress"]'); await page.wait_for_timeout(500); print('  back to progress:', (await txt('.cx-viewas')).replace('\n',' | '))
        # 3 editor: edit Parsons connection → Ended → picker → done → save
        await page.click('[data-cxa="edit"]'); await page.wait_for_selector('.cx-editor')
        await page.screenshot(path=f'{SH}/u13-editor.png')
        await page.click('[data-link^="relations:0"]'); await page.wait_for_timeout(300)
        print('3 link view:', (await txt('.cx-editor')).replace('\n',' | ')[:300])
        await page.fill('[data-lv-label]','secret lover')
        await page.click('[data-chpick="since"]'); await page.wait_for_timeout(300)
        print('  picker step:', (await txt('.cp-head')).replace('\n',' | '))
        await page.go_back(); await page.wait_for_timeout(300)   # phone back → link view, not closed
        print('  after phone back still in link view:', await page.is_visible('[data-lv-label]'), await page.input_value('[data-lv-label]'))
        await page.click('[data-lv="ended"]'); await page.click('[data-chpick="until"]'); await page.wait_for_timeout(300)
        await page.click('.cp-list [data-cp="3"]'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{SH}/u13-editlink.png')
        await page.click('[data-lv="done"]'); await page.wait_for_timeout(300)
        print('  back on form rows:', await page.eval_on_selector_all('[data-link]','e=>e.map(x=>x.innerText.replace(/\\n/g," / "))'))
        # value edit
        await page.click('[data-val="role:1"]'); await page.wait_for_timeout(300)
        await page.fill('[data-vv]','Records clerk, Ministry of Truth'); await page.click('[data-vw="done"]'); await page.wait_for_timeout(300)
        await page.click('[data-newval="role"]'); await page.fill('[data-tf="role"]','Arrested')
        await page.click('[data-ed="save"]'); await page.wait_for_timeout(700)
        e = await page.evaluate("import('./js/db.js').then(d=>d.getCodexEntry(3))")
        print('  saved fields:', json.dumps(e['fields']))
        print('  hash after save:', await page.evaluate('location.hash'), '| history state', await page.evaluate('JSON.stringify(history.state)'))
        # 4 drawer Edit → direct
        await page.click('[data-drawer$=":1"]'); await page.wait_for_timeout(300)
        await page.click('.cx-lrow.is-open [data-cxa="edit-link"]'); await page.wait_for_selector('[data-lv-label]')
        await page.click('[data-lv="ended"]'); await page.click('[data-lv="done"]'); await page.wait_for_timeout(700)
        e = await page.evaluate("import('./js/db.js').then(d=>d.getCodexEntry(3))")
        print('4 direct edit saved:', json.dumps(e['fields']['relations']), '| overlay open:', await page.is_visible('.sheet'))
        await page.click('a[data-back]'); await page.wait_for_timeout(600); print('  back arrow after edits →', await page.evaluate('location.hash'))
        # 5 reader panel codex tab
        await page.goto(B+'#/read/1'); await page.wait_for_timeout(800)
        cnt = lambda: page.eval_on_selector_all('span.cx-name','e=>e.length')
        print('5 names marked:', await cnt())
        await page.evaluate("document.querySelector('.vis-btn').click()"); await page.wait_for_selector('.vis-box')
        await page.click('[data-vis-tab="codex"]'); await page.wait_for_timeout(200)
        print('  codex tab:', (await txt('.vis-box')).replace('\n',' | ')[:300])
        await page.click('[data-room="character"]'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{SH}/u13-show.png')
        print('  characters off → marks:', await cnt())
        await page.go_back(); await page.wait_for_timeout(300)
        print('  dot:', await page.evaluate("document.querySelector('.vis-btn').classList.contains('is-filtered')"))
        # 6 chapter end next replaces
        await page.goto(B+'#/series/1'); await page.goto(B+'#/read/1'); await page.wait_for_timeout(600)
        await page.evaluate("document.querySelector('.next-card').click()"); await page.wait_for_timeout(700)
        print('6 next →', await page.evaluate('location.hash'))
        await page.evaluate("document.querySelector('a[data-back]').click()"); await page.wait_for_timeout(600); print('  back arrow →', await page.evaluate('location.hash'))
        # 7 close editor from inside two steps (backdrop) → history clean
        await page.goto(B+'#/series/1/codex'); await page.goto(B+'#/codex/3'); await page.wait_for_timeout(600)
        st0 = await page.evaluate('JSON.stringify(history.state)')
        await page.click('[data-cxa="edit"]'); await page.click('[data-link^="relations:0"]'); await page.click('[data-chpick="since"]'); await page.wait_for_timeout(300)
        await page.evaluate("document.querySelector('.sheet-backdrop').click()"); await page.wait_for_timeout(600)
        print('7 state before', st0, 'after closing from a step', await page.evaluate('JSON.stringify(history.state)'), await page.evaluate('location.hash'), 'sheet:', await page.is_visible('.sheet'))
        await page.evaluate("document.querySelector('a[data-back]').click()"); await page.wait_for_timeout(600); print('  then back arrow →', await page.evaluate('location.hash'))
        print('errors:', errs)
        await b.close()
asyncio.run(main())
