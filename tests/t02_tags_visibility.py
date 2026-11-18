import asyncio, sys, os
from playwright.async_api import async_playwright
S=sys.argv[1]; B='http://localhost:8765/'; SH=f'{S}/shots'; D=f'{S}/fixtures/1984'
SEL = """(text) => { for(const p of document.querySelectorAll('#text p[data-p]')){ const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ const i=n.data.indexOf(text); if(i>=0){ p.scrollIntoView({block:'center'}); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+text.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } } }"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=os.environ.get('CHROME') or None,args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,reduced_motion='reduce')
        page=await ctx.new_page(); errs=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        page.on('console', lambda m: m.type=='error' and 'Failed to load' not in m.text and errs.append(m.text))
        await page.goto(B+'#/import'); await page.wait_for_selector('.drop-card')
        await page.set_input_files('#file-input',[f'{D}/1984 ch1.txt',f'{D}/1984 ch2.txt',f'{D}/1984 ch3.txt', f'{S}/fixtures/other/other 1.txt'])
        await page.wait_for_selector('.review .group'); await page.click('[data-review="import"]'); await page.wait_for_timeout(1500)
        # old state: shared tags used by notes in 2 series + series tag
        await page.evaluate("""import('./js/db.js').then(async d=>{
          const ss=await d.getAllSeries(); const a=ss.find(s=>s.name==='1984').id, o=ss.find(s=>s.name!=='1984').id;
          const chs=await d.getAllChapters(); const c=n=>chs.find(x=>x.seriesId===a&&x.number===n).id, oc=chs.find(x=>x.seriesId===o).id;
          const ids={}; for(const [n,c] of [['Vocabulary','blue'],['Characters','purple'],['Plot','red'],['Unused','green']]) ids[n]=(await d.addTag(n,c,null)).id; const T=n=>ids[n];
          const plot=await d.addTag('Places','teal',a);
          const mk=(cid,sid,p,q,tagIds)=>d.putNote({seriesId:sid,chapterId:cid,sp:p,so:0,ep:p,eo:q.length,quote:q,text:'',tagIds,createdAt:1,updatedAt:1});
          await mk(c(1),a,0,'Winston Smith',[T('Characters')]); await mk(c(1),a,1,'Outside',[T('Vocabulary')]);
          await mk(c(2),a,0,'Winston opened',[T('Plot')]); await mk(c(3),a,0,'Tom Parsons',[T('Characters')]); await mk(c(1),a,2,'Winston thought',[]);
          await mk(oc,o,0,'Someone',[T('Vocabulary')]);
          window.__a=a; })""")
        a = await page.evaluate('window.__a')
        await page.goto(B+'#/'); await page.reload(); await page.wait_for_selector('.series-card'); await page.wait_for_timeout(500)
        tags = await page.evaluate("import('./js/db.js').then(d=>d.getAllTags()).then(l=>l.map(t=>[t.id,t.name,t.seriesId]))")
        print('1 tags after migration:', tags)
        notes = await page.evaluate("import('./js/db.js').then(d=>d.getAllNotes()).then(l=>l.map(n=>[n.seriesId,n.quote,n.tagIds]))")
        print('  notes:', notes)
        # 2 Tags tab
        await page.goto(B+f'#/series/{a}/tags'); await page.wait_for_selector('.tags-tab')
        print('2 tabs:', await page.eval_on_selector_all('.series-tabs button','e=>e.map(x=>x.innerText.replace(/\\s+/g," "))'))
        print('  tags tab:', (await page.inner_text('.tags-tab')).replace('\n',' | '))
        await page.screenshot(path=f'{SH}/u12-tags.png')
        await page.click('[data-tag-new]'); await page.fill('#tag-name','Concepts'); await page.click('[data-te="save"]'); await page.wait_for_timeout(500)
        await page.click('.tags-row:has-text("Places")'); await page.wait_for_selector('#tag-name'); await page.fill('#tag-name','Locations')
        await page.click('[data-color="red"]'); await page.screenshot(path=f'{SH}/u12-edittag.png'); await page.click('[data-te="save"]'); await page.wait_for_timeout(500)
        print('  after add/edit:', await page.eval_on_selector_all('.tags-row b','e=>e.map(x=>x.innerText)'))
        # 3 reader visibility
        await page.goto(B+'#/read/1'); await page.wait_for_selector('#text p[data-p]'); await page.wait_for_timeout(600)
        marks=lambda: page.eval_on_selector_all('mark.note-mark','e=>[...new Set(e.map(x=>x.dataset.note))].length')
        print('3 marks before:', await marks())
        await page.mouse.click(195,400); await page.wait_for_timeout(300); await page.click('.vis-btn'); await page.wait_for_selector('.vis-list')
        print('  panel:', (await page.inner_text('.vis-list')).replace('\n',' | '))
        await page.click('[data-vis-all="off"]'); await page.wait_for_timeout(300); print('  all off marks:', await marks())
        await page.screenshot(path=f'{SH}/u12-panel.png')
        chars = await page.evaluate("import('./js/db.js').then(d=>d.getAllTags()).then(l=>l.find(t=>t.name==='Characters'&&t.seriesId==SID).id)".replace('SID',str(a)))
        await page.click(f'[data-vis="{chars}"]'); await page.wait_for_timeout(300); print('  characters on:', await marks())
        await page.go_back(); await page.wait_for_timeout(300)
        print('  btn filtered:', await page.evaluate("document.querySelector('.vis-btn').classList.contains('is-filtered')"))
        # new note under hidden tag
        vocab = await page.evaluate("import('./js/db.js').then(d=>d.getAllTags()).then(l=>l.find(t=>t.name==='Vocabulary'&&t.seriesId==SID).id)".replace('SID',str(a)))
        await page.evaluate(SEL,'grimy'); await page.wait_for_timeout(400); await page.click('[data-sel="note"]'); await page.wait_for_selector('#note-text')
        print('  editor groups:', (await page.inner_text('.tag-groups')).replace('\n',' | '))
        await page.click(f'.tag-chip[data-tag="{vocab}"]'); await page.click('[data-ne="save"]'); await page.wait_for_timeout(500)
        print('  toast:', await page.inner_text('#toast'), '| marks:', await marks())
        await page.screenshot(path=f'{SH}/u12-kept.png')
        await page.evaluate("document.querySelector('.vis-btn').click()"); await page.wait_for_selector('.vis-list')
        await page.click(f'[data-vis="{vocab}"]'); await page.click(f'[data-vis="{vocab}"]'); await page.wait_for_timeout(300)
        print('  vocab toggled on+off, marks:', await marks())
        await page.go_back(); await page.wait_for_timeout(300)
        # 4 notes range
        await page.goto(B+f'#/series/{a}/notes'); await page.wait_for_selector('.series-notes'); await page.wait_for_timeout(300)
        print('4 notes:', await page.inner_text('#notes-count'))
        await page.click('[data-nt="range"]'); await page.wait_for_selector('.range-list')
        await page.check('input[value="range"]'); await page.wait_for_timeout(200)
        await page.select_option('[data-rs="from"]','2'); await page.select_option('[data-rs="to"]','3'); await page.wait_for_timeout(200)
        await page.screenshot(path=f'{SH}/u12-range.png')
        print('  apply btn:', await page.inner_text('[data-rs-apply]')); await page.click('[data-rs-apply]'); await page.wait_for_timeout(400)
        print('  count:', await page.inner_text('#notes-count'), '| chip:', await page.inner_text('.range-chip'))
        await page.screenshot(path=f'{SH}/u12-notes.png')
        await page.click('[data-nt="range"]'); await page.check('input[value="one"]'); await page.select_option('[data-rs="at"]','1'); await page.click('[data-rs-apply]'); await page.wait_for_timeout(300)
        print('  only ch1:', await page.inner_text('#notes-count'))
        # 5 all-series notes chips by name
        await page.goto(B+'#/notes'); await page.wait_for_selector('.series-pick')
        await page.click('.series-pick'); await page.click('[data-pick-series="all"]'); await page.wait_for_timeout(300)
        print('5 all chips:', await page.eval_on_selector_all('[data-ntag]','e=>e.map(x=>x.innerText.replace(/\\s+/g," "))'))
        await page.click('[data-ntag="n:vocabulary"]'); await page.wait_for_timeout(200); print('  vocab across series:', await page.inner_text('#notes-count'))
        print('errors:', errs)
        await b.close()
asyncio.run(main())
