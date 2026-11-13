import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path(__file__).parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True)
  context=await b.new_context(viewport={"width":1280,"height":1800})
  page=await context.new_page()
  if os.environ.get('LOVABLE_BROWSER_AUTH_STATUS')=='injected':
   key=os.environ['LOVABLE_BROWSER_SUPABASE_STORAGE_KEY']; session=os.environ['LOVABLE_BROWSER_SUPABASE_SESSION_JSON']
  else:
   with open(os.path.expanduser('~/.cache/lovable-auth/session.json')) as f: minted=json.load(f)
   key=minted['storage_key'];session=json.dumps(minted['session'])
  await page.goto('http://localhost:8080');await page.evaluate('([k,v])=>localStorage.setItem(k,v)',[key,session])
  state={'busy':False,'job':None,'history':[],'previewVersion':1,'publish':{'ok':True,'open':2},'review':{'enabled':True},'draft':{'requests':[{'id':'fixture','request':'Changed design','page':{'name':'Homepage','path':'/'},'at':1794564000000}]}}
  async def relay(route):
   url=route.request.url
   body=state if url.endswith('/state') else {'ok':True,'rows':[{'name':'Homepage','path':'/','how':[],'requestIds':['fixture']},{'name':'Contact','path':'/contact','how':[],'requestIds':['fixture']}],'components':[],'objects':[],'sitewide':{'files':[],'requestIds':[]}} if url.endswith('/review-pages') else {'ok':True,'groups':[],'unread':0}
   await route.fulfill(json=body)
  await page.route('**/api/**',relay)
  for width in [375,320,1280]:
   await page.set_viewport_size({'width':width,'height':812 if width<600 else 1800})
   await page.evaluate("sessionStorage.clear()")
   await page.goto('http://localhost:8080/manage/preview');await page.wait_for_timeout(2500)
   if width<600: await page.get_by_role('button',name='Menu',exact=True).click()
   await page.get_by_role('button',name='Submit for Review',exact=True).click()
   await page.wait_for_timeout(2500)
   bar=page.get_by_role('region',name='Checking Changes')
   print(width,'auto page',await bar.inner_text())
   await page.wait_for_timeout(300)
   buttons=await bar.get_by_role('button').evaluate_all('(es)=>es.map(e=>({text:e.innerText,height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top,width:e.clientWidth,overflow:e.scrollWidth>e.clientWidth,size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight,radius:getComputedStyle(e).borderRadius}))')
   assert all(not x['overflow'] for x in buttons)
   assert buttons[-1]['height']==buttons[-2]['height']==44
   assert buttons[-1]['top']==buttons[-2]['top']
   assert buttons[-1]['size']==buttons[-2]['size'] and buttons[-1]['weight']==buttons[-2]['weight'] and buttons[-1]['radius']==buttons[-2]['radius']
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(OUT/f'{width}-page.png'))
   await bar.get_by_role('button',name='Approve',exact=True).click()
   await page.wait_for_timeout(250)
   print(width,'next page disabled',await bar.get_by_role('button',name='Next Page').is_disabled())
   await bar.get_by_role('button',name='Approve',exact=True).click()
   await page.wait_for_timeout(300)
   panel=page.get_by_role('region',name='Submit for Review Walkthrough')
   print(width,'list approvals',await panel.get_by_role('checkbox').count(),'overflow',await page.evaluate('document.documentElement.scrollWidth>innerWidth'))
   await page.screenshot(path=str(OUT/f'{width}-list.png'))
   reminder=panel.get_by_text('Before you approve:',exact=True)
   title=panel.get_by_role('heading',name='Design Check',exact=True)
   first=panel.locator('[data-walk-row]').first
   assert (await title.bounding_box())['y']<(await reminder.bounding_box())['y']<(await first.bounding_box())['y']
   await panel.get_by_role('button',name='Homepage /',exact=True).click()
   await page.wait_for_timeout(300)
   assert await bar.get_by_role('button',name='Approved',exact=True).count()==1
   await page.screenshot(path=str(OUT/f'{width}-approved.png'))
   print(width,'reminder above list and quiet Approved control, final Submit NOT pressed')
  await b.close()
asyncio.run(main())
