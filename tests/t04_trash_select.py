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
          const o=await d.putCodexEntry({seriesId:1,type:'character',name:'Parsons',aliases:[],since:1,fields:{},about:''});
          const m=await d.putCodexEntry({seriesId:1,type:'place',name:'Victory Mansions',aliases:[],since:1,fields:{},about:''});
          await d.putCodexEntry({seriesId:1,type:'character',name:'Winston',aliases:['Smith'],since:1,about:'Keeps a diary.',
            fields:{role:[{v:'Records clerk',since:1},{v:'Under suspicion',since:3}],relations:[{id:j.id,label:'lover',since:2},{id:o.id,label:'neighbour',since:1}]}});
          await d.putCodexEntry({seriesId:1,type:'character',name:'Julia2',aliases:[],since:1,fields:{relations:[{id:j.id,label:'x',since:1}]},about:''});
          const t=await d.addTag('Plot','red',1); const v=await d.addTag('Vocab','blue',1);
          for(let i=0;i<6;i++) await d.putNote({seriesId:1,chapterId:1+(i%3),sp:0,so:0,ep:0,eo:7,quote:'Quote '+i,text:'',tagIds:[i%2?t.id:v.id],createdAt:i,updatedAt:i});
        })""")
        H=lambda: page.evaluate('location.hash')
        async def longpress(sel):
            box=await page.locator(sel).first.bounding_box()
            await page.mouse.move(box['x']+30, box['y']+box['height']/2); await page.mouse.down(); await page.wait_for_timeout(650); await page.mouse.up(); await page.wait_for_timeout(300)
        await page.goto(B+'#/'); await page.goto(B+'#/read/3'); await page.wait_for_timeout(700)
        # 1 codex tab tools
        await page.goto(B+'#/series/1/codex'); await page.wait_for_timeout(600)
        print('1 chips:', await page.eval_on_selector_all('.cx-chips button','e=>e.map(x=>x.innerText.replace(/\\s+/g," ").trim())'))
        await page.click('[data-room="character"]'); await page.wait_for_timeout(300)
        print('  characters:', await page.inner_text('#cx-count'), await page.eval_on_selector_all('.cx-flat .cx-row b','e=>e.map(x=>x.innerText)'))
        await page.fill('#cx-q','smi'); await page.wait_for_timeout(200)
        print('  search smi:', await page.eval_on_selector_all('.cx-flat .cx-row b','e=>e.map(x=>x.innerText)'))
        await page.fill('#cx-q',''); await page.click('[data-cx="sort"]'); await page.click('input[value="appear"]'); await page.wait_for_timeout(500)
        print('  appearance sort:', await page.eval_on_selector_all('.cx-flat .cx-row b','e=>e.map(x=>x.innerText)'))
        await page.screenshot(path=f'{SH}/u14-tab.png')
        await page.click('[data-room="all"]'); await page.wait_for_timeout(200)
        # 2 return bar: reader → codex tool → Winston → Julia → Parsons? (Julia has no links) use Winston → Parsons
        await page.goto(B+'#/read/3'); await page.wait_for_timeout(700)
        await page.evaluate("document.querySelector('[data-action=\"reader-codex\"]').click()"); await page.wait_for_timeout(500)
        await page.click('.sheet a.cx-row:has-text("Winston")'); await page.wait_for_timeout(700)
        print('2 entry from reader, bar:', (await page.inner_text('.cx-return')).replace('\n',' ') if await page.query_selector('.cx-return') else None)
        await page.click('.cx-lname:has-text("Julia")'); await page.wait_for_timeout(600)
        await page.goto(B+'#/codex/2') if False else None
        print('  on Julia, bar:', (await page.inner_text('.cx-return')).replace('\n',' '))
        await page.screenshot(path=f'{SH}/u14-return.png')
        await page.click('.cx-ret-origin'); await page.wait_for_timeout(800)
        print('  ↩ origin →', await H())
        # 3 drawer delete + undo
        await page.goto(B+'#/codex/4'); await page.wait_for_timeout(600)
        await page.click('.cx-vrow:has-text("Under suspicion") .cx-chev'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{SH}/u14-drawer.png')
        await page.click('.cx-vrow.is-open [data-cxa="del"]'); await page.wait_for_timeout(500)
        print('3 toast:', await page.inner_text('#toast'), '| role now:', await page.evaluate("import('./js/db.js').then(d=>d.getCodexEntry(4)).then(e=>JSON.stringify(e.fields.role))"))
        await page.click('#toast button'); await page.wait_for_timeout(700)
        print('  undo →', await page.evaluate("import('./js/db.js').then(d=>d.getCodexEntry(4)).then(e=>JSON.stringify(e.fields.role))"), 'trash:', await page.evaluate("import('./js/db.js').then(d=>d.getAllTrash()).then(l=>l.length)"))
        # 4 long-press select → delete 2
        await longpress('.cx-vrow:has-text("Records clerk")')
        print('4 selecting:', await page.inner_text('.pick-bar b'))
        await page.click('[data-pick-key^="l:relations:1"]'); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{SH}/u14-select.png')
        await page.click('[data-sel="delete"]'); await page.wait_for_timeout(800)
        e=await page.evaluate("import('./js/db.js').then(d=>d.getCodexEntry(4))")
        print('  after delete:', json.dumps(e['fields']), '| state', await page.evaluate('JSON.stringify(history.state)'), '| selecting?', await page.query_selector('.pick-bar') is not None)
        # 5 trash page restore
        await page.goto(B+'#/settings'); await page.click('a.trash-link'); await page.wait_for_timeout(600)
        print('5 trash:', (await page.inner_text('.trash-page')).replace('\n',' | ')[:400])
        await page.screenshot(path=f'{SH}/u14-trash.png')
        await page.click('[data-restore]'); await page.wait_for_timeout(600)
        e=await page.evaluate("import('./js/db.js').then(d=>d.getCodexEntry(4))")
        print('  restored:', json.dumps(e['fields']))
        # 6 entry delete with backlinks + restore
        await page.goto(B+'#/codex/1'); await page.wait_for_timeout(500)
        await page.click('[data-cxa="edit"]'); await page.click('[data-ed="delete"]'); await page.wait_for_timeout(700)
        rel=lambda: page.evaluate("import('./js/db.js').then(d=>Promise.all([d.getCodexEntry(4),d.getCodexEntry(5),d.getCodexEntry(1)])).then(a=>JSON.stringify([a[0].fields.relations.map(x=>x.id),a[1].fields.relations.map(x=>x.id),!!a[2]]))")
        print('6 after entry delete:', await rel(), await H())
        await page.click('#toast button'); await page.wait_for_timeout(700)
        print('  undo:', await rel())
        # 7 editor removal recorded
        await page.goto(B+'#/codex/4'); await page.wait_for_timeout(500)
        await page.click('[data-cxa="edit"]'); await page.click('[data-link^="relations:0"]'); await page.click('[data-lv="remove"]'); await page.wait_for_timeout(200)
        await page.click('[data-ed="save"]'); await page.wait_for_timeout(600)
        print('7 toast:', await page.inner_text('#toast'), '| trash:', await page.evaluate("import('./js/db.js').then(d=>d.getAllTrash()).then(l=>l.map(t=>t.title))"))
        # 8 notes select
        await page.goto(B+'#/series/1/notes'); await page.wait_for_timeout(600)
        await page.click('[data-nsel="start"]'); await page.click('.note-card >> nth=0'); await page.click('.note-card >> nth=1'); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{SH}/u14-notes.png')
        await page.click('[data-nsel="tag"]'); await page.wait_for_selector('.bulk-box')
        print('8 bulk tag:', (await page.inner_text('.bulk-box')).replace('\n',' | '))
        await page.click('[data-bt]:has-text("Plot")'); await page.click('[data-bt-done]'); await page.wait_for_timeout(500)
        print('  still selecting:', await page.inner_text('#nsel-count'))
        await page.click('[data-nsel="delete"]'); await page.wait_for_timeout(700)
        print('  deleted toast:', await page.inner_text('#toast'), '| notes left', await page.evaluate("import('./js/db.js').then(d=>d.getAllNotes()).then(l=>l.length)"), '| bar hidden', await page.evaluate("document.querySelector('.notes-selbar').hidden"))
        await page.click('#toast button'); await page.wait_for_timeout(600)
        print('  undo notes:', await page.evaluate("import('./js/db.js').then(d=>d.getAllNotes()).then(l=>l.length)"))
        # long-press to start + phone back exits
        await longpress('.note-card >> nth=2')
        print('  longpress count:', await page.inner_text('#nsel-count'))
        await page.go_back(); await page.wait_for_timeout(400)
        print('  phone back exits select:', await page.evaluate("document.querySelector('.notes-selbar').hidden"), await H())
        # 9 tag delete → restore
        await page.goto(B+'#/series/1/tags'); await page.wait_for_timeout(500)
        await page.click('.tags-row:has-text("Vocab")'); await page.click('[data-te="delete"]'); await page.wait_for_timeout(600)
        cnt=lambda: page.evaluate("import('./js/db.js').then(d=>d.getAllNotes()).then(l=>l.filter(n=>n.tagIds.includes(6)).length)")
        print('9 vocab notes after delete:', await cnt(), await page.inner_text('#toast'))
        await page.click('#toast button'); await page.wait_for_timeout(600); print('  after undo:', await cnt())
        print('errors:', errs)
        await b.close()
asyncio.run(main())
