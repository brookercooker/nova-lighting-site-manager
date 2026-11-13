import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path("/tmp/browser/library-grid")
OUT.mkdir(parents=True, exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True)
  context=await b.new_context(viewport={"width":1280,"height":1800})
  page=await context.new_page()
  with open(os.path.expanduser('~/.cache/lovable-auth/session.json')) as f: minted=json.load(f)
  await page.goto('http://localhost:8080')
  await page.evaluate('([k,v])=>localStorage.setItem(k,v)',[minted['storage_key'],json.dumps(minted['session'])])
  for width in [320,375,487,768,1280]:
   await page.set_viewport_size({'width':width,'height':812 if width<600 else 1800})
   for route,scope,default in [('objects','objects','grid'),('pages','static','list'),('pages?tab=landing','landing','list'),('images','images','grid'),('videos','videos','grid')]:
    await page.evaluate('(s)=>localStorage.removeItem("nova:library-view:"+s)',scope)
    await page.goto('http://localhost:8080/manage/'+route)
    await page.get_by_role('button',name='Grid view',exact=True).wait_for()
    await page.wait_for_timeout(1200)
    assert await page.get_by_role('button',name=default.capitalize()+' view',exact=True).get_attribute('aria-pressed')=='true'
    await page.get_by_role('button',name='Grid view',exact=True).click()
    await page.wait_for_timeout(600)
    layout=await page.locator('[data-library-items="grid"]').evaluate('''e=>({width:e.clientWidth,columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,overflow:e.scrollWidth>e.clientWidth,top:e.getBoundingClientRect().top,toolbar:document.querySelector('[data-library-toolbar]').getBoundingClientRect().bottom,pageOverflow:document.documentElement.scrollWidth>innerWidth})''')
    print(width,scope,layout, 'rows',await page.locator('[data-library-row]').count())
    assert not layout['overflow'] and not layout['pageOverflow']
    container_width=await page.locator(".nova-library-content").evaluate("e=>e.clientWidth")
    expected=(1 if container_width<340 else 2 if container_width<900 else 3) if scope in ["objects","images","videos"] else layout["columns"]
    assert layout['columns']==expected, (width,scope,layout)
    assert layout['top']-layout['toolbar']<240
    if scope in ['objects','images','videos']:
     assert (layout['width']-12*(expected-1))/expected>=160
    await page.screenshot(path=str(OUT/f'{scope}-{width}.png'))
    if await page.locator('[data-library-row]').count():
     row=page.locator('[data-library-row]').first
     await row.get_by_role('button',name='Options for ',exact=False).click()
     assert await page.get_by_role('menu').is_visible()
     await page.keyboard.press('Escape')
     await page.locator('[data-library-toolbar]').get_by_role('button',name='Select' if scope in ['objects','images','videos'] else 'Edit',exact=True).click()
     await page.screenshot(path=str(OUT/f'{scope}-{width}-selection.png'))
     checkbox=page.get_by_role('checkbox',name='Select ',exact=False).first
     await checkbox.check()
     await page.get_by_role('button',name='List view',exact=True).click()
     assert await checkbox.is_checked()
     await checkbox.uncheck()
     await page.get_by_role('button',name='Grid view',exact=True).click()
     assert not await checkbox.is_checked()
     await page.get_by_role('button',name='Done',exact=True).click()
     await page.locator('main').last.evaluate('e=>e.scrollTop=e.scrollHeight')
     await page.wait_for_timeout(300)
     bottom=await page.locator('[data-library-items]').evaluate('e=>e.getBoundingClientRect().bottom')
     add=page.get_by_role('button',name='Add '+('Object' if scope=='objects' else 'Image' if scope=='images' else 'Video' if scope=='videos' else 'Landing Page' if scope=='landing' else 'Page'),exact=True).last
     if width<600:
      assert bottom>(await add.bounding_box())['y']+48
     await page.locator('main').last.evaluate('e=>e.scrollTop=0')
    await page.reload()
    await page.get_by_role('button',name='Grid view',exact=True).wait_for()
    assert await page.get_by_role('button',name='Grid view',exact=True).get_attribute('aria-pressed')=='true'
  await b.close()
asyncio.run(main())
