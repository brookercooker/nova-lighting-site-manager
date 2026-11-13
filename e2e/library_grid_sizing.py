import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('/tmp/browser/larger-grid')
async def check(page, scope, label):
 grid=page.locator('[data-library-items="grid"]')
 await page.wait_for_timeout(400)
 sizes=await grid.evaluate('''e=>({width:e.clientWidth,container:e.closest('.nova-library-content').clientWidth,columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,gap:parseFloat(getComputedStyle(e).gap),overflow:e.scrollWidth>e.clientWidth})''')
 expected=1 if sizes['container']<340 else 2 if sizes['container']<900 else 3
 assert sizes['columns']==expected,(label,scope,sizes)
 assert not sizes['overflow'] and not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
 assert (sizes['width']-sizes['gap']*(expected-1))/expected>=160
 rows=page.locator('[data-library-row]')
 metrics=await rows.evaluate_all('''es=>es.slice(0,6).map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,overflow:e.scrollWidth>e.clientWidth,thumb:(()=>{const r=e.querySelector('.nova-library-grid-thumb').getBoundingClientRect();return r.width/r.height})(),menu:(()=>{const r=e.querySelector('.nova-library-grid-options').getBoundingClientRect(); const p=e.getBoundingClientRect();return r.x>=p.x&&r.right<=p.right})()}))''')
 assert all(not m['overflow'] and m['menu'] and abs(m['thumb']-4/3)<.03 for m in metrics)
 for m in metrics:
  assert all(abs(m['height']-n['height'])<1 for n in metrics if abs(m['top']-n['top'])<1)
 await page.screenshot(path=str(OUT/f'{scope}-{label}.png'))
 print(scope,label,sizes,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  context=await browser.new_context(viewport={'width':1280,'height':1800})
  page=await context.new_page()
  with open(os.path.expanduser('~/.cache/lovable-auth/session.json')) as f: auth=json.load(f)
  await page.goto('http://localhost:8080')
  await page.evaluate('([k,v])=>localStorage.setItem(k,v)',[auth['storage_key'],json.dumps(auth['session'])])
  for width in [320,375,487,768,1280]:
   await page.set_viewport_size({'width':width,'height':812 if width<600 else 1800})
   for scope in ['objects','images','videos']:
    await page.goto('http://localhost:8080/manage/'+scope)
    toolbar=page.locator('[data-library-toolbar]')
    await toolbar.get_by_role('button',name='Grid view',exact=True).wait_for()
    await toolbar.get_by_role('button',name='Grid view',exact=True).click()
    await page.locator('[data-library-row]').first.wait_for()
    await check(page,scope,str(width))
    await toolbar.get_by_role('button',name='Select',exact=True).click()
    checkbox=page.get_by_role('checkbox',name='Select ',exact=False).first
    await checkbox.check()
    await toolbar.get_by_role('button',name='List view',exact=True).click()
    assert await checkbox.is_checked()
    await toolbar.get_by_role('button',name='Grid view',exact=True).click()
    assert await checkbox.is_checked()
    await checkbox.uncheck()
    await toolbar.get_by_role('button',name='Done',exact=True).click()
    if width==1280:
     for container in [320,339,340,487,899,900,1100]:
      await page.locator('.nova-library-content').evaluate('(e,w)=>{e.style.flex="none";e.style.width=w+"px"}',container)
      await check(page,scope,'container-'+str(container))
  await browser.close()
asyncio.run(main())
