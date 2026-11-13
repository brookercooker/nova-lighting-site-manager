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
   body=state if url.endswith('/state') else {'ok':True,'rows':[{'name':'Homepage','path':'/','how':[],'requestIds':['fixture']},{'name':'Contact','path':'/contact','how':[],'requestIds':['fixture']}],'components':[],'objects':[],'sitewide':{'files':[],'requestIds':[]}} if url.endswith('/review-pages') else {'ok':True,'groups':[{'page':{'name':'Homepage','path':'/'},'label':'Homepage','links':[{'href':'https://google.com','kind':'external','label':'Google','elementKey':'0.1','scope':'page'},{'href':'/contact','kind':'internal','label':'Contact','elementKey':'0.2','scope':'page'},{'href':'/missing','kind':'internal','label':'Missing','elementKey':'0.3','scope':'page'},{'href':'https://lnstagram.com','kind':'external','label':'Instagram','elementKey':'0.4','scope':'page'}]}],'unread':0}
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
   await bar.get_by_role('button',name='Approve',exact=True).click()
   await bar.get_by_role('button',name='Approve',exact=True).click()
   panel=page.get_by_role('region',name='Submit for Review Walkthrough')
   await panel.get_by_role('button',name='Next',exact=True).click()
   await panel.get_by_role('heading',name='Verify Changed Links',exact=True).wait_for()
   await panel.get_by_role('link',name='Open link to verify Google',exact=True).wait_for()
   assert await panel.get_by_role('button',name='Approve: Google',exact=True).is_disabled()
   scroller=panel.locator('div.overflow-y-auto').first
   await scroller.evaluate('(e)=>e.scrollTop=50')
   before=await scroller.evaluate('(e)=>e.scrollTop')
   async with context.expect_page() as new:
    await panel.get_by_role('link',name='Open link to verify Google',exact=True).click()
   tab=await new.value
   before=await scroller.evaluate("(e)=>e.scrollTop")
   await tab.close()
   await page.bring_to_front()
   await page.wait_for_timeout(500)
   assert await panel.get_by_role('button',name='Approve: Google',exact=True).is_enabled()
   assert before==await scroller.evaluate('(e)=>e.scrollTop')
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   assert await panel.get_by_text('Trusted Domains',exact=True).count()==0
   assert await panel.get_by_text('Page found',exact=True).count()==0
   await page.screenshot(path=str(OUT/f'{width}-links.png'))
   await panel.get_by_role('button',name='Correct link: Google',exact=True).click()
   await panel.get_by_label('New Destination',exact=True).fill('https://lnstagram.com')
   assert await panel.get_by_text('Looks like instagram.com',exact=False).count()>0
   assert await panel.get_by_role('link',name='Open New Destination in New Tab').count()==1
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(OUT/f'{width}-editor.png'))
   controls=await panel.locator('button,a').evaluate_all('(es)=>es.filter(e=>e.offsetParent&&(/Approve|Correct|Save|Cancel|Open link to verify/.test(e.getAttribute("aria-label")||e.innerText))).map(e=>({name:e.getAttribute("aria-label")||e.innerText,height:e.getBoundingClientRect().height}))')
   assert all(e['height']>=44 for e in controls),controls
   print(width,'link cards and inline editor: opening gate, no overflow, 44px, stable tab return. Final Submit NOT pressed.')
  await b.close()
asyncio.run(main())
