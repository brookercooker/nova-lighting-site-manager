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
  pages=[('/', 'Homepage',2),('/pricing','Pricing',1),('/contact','Contact',2),('/unchanged','Unchanged',1)]
  groups=[{'page':{'path':path,'name':name},'label':name,'links':[{'elementKey':f'0.{i}','scope':'page','href':'https://example.com/shared','publishedHref':'https://example.com/shared' if name=='Unchanged' else 'https://example.com/before','label':f'{name} {i+1}','kind':'external'} for i in range(count)]} for path,name,count in pages]
  state={'busy':False,'history':[],'previewVersion':1,'publish':{'ok':True,'open':3},'review':{'enabled':True},'draft':{'requests':[{'id':'fixture','request':'Three page changes','page':{'name':'Homepage','path':'/'},'at':1794564000000}]}}
  async def relay(route):
   url=route.request.url
   body=state if url.endswith('/state') else {'ok':True,'rows':[{'path':path,'name':name,'how':[],'requestIds':['fixture']} for path,name,count in pages[:3]],'components':[],'objects':[],'sitewide':{'files':[],'requestIds':[]}} if url.endswith('/review-pages') else {'ok':True,'groups':groups,'unread':0}
   await route.fulfill(json=body)
  await page.route('**/api/**',relay)
  await page.route('https://example.com/**',lambda r:r.fulfill(body='<h1>Opened destination</h1>',content_type='text/html'))
  html="""<h1>Public fixture</h1><script>function post(d){parent.postMessage({source:'nova-site',...d},'http://localhost:8080')}addEventListener('message',e=>{if(e.data.type==='navigate'){history.replaceState(null,'',e.data.path);post({type:'location',path:location.pathname})}if(e.data.type==='link-check')post({type:'link-check-ready',v:2,enabled:true});if(e.data.type==='link-inventory-request')post({type:'link-inventory',v:1,path:location.pathname,links:[]})});post({type:'preview-ready'});post({type:'location',path:location.pathname});</script>"""
  await page.route('https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app/**',lambda r:r.fulfill(body=html,content_type='text/html'))
  for width in [375,320,1280]:
   await page.set_viewport_size({'width':width,'height':812 if width<600 else 1800});await page.evaluate('sessionStorage.clear()')
   await page.goto('http://localhost:8080/manage/preview');await page.wait_for_timeout(2000)
   if width<600: await page.get_by_role('button',name='Menu',exact=True).click()
   await page.get_by_role('button',name='Submit for Review',exact=True).click();await page.wait_for_timeout(1800)
   bar=page.get_by_role('region',name='Checking Changes')
   for _ in range(3): await bar.get_by_role('button',name='Approve',exact=True).click()
   panel=page.get_by_role('region',name='Submit for Review Walkthrough')
   await panel.get_by_role('button',name='Next',exact=True).click()
   await panel.get_by_role('heading',name='Verify Changed Links',exact=True).wait_for()
   await panel.get_by_text('0 of 5 links approved',exact=True).wait_for()
   assert await panel.get_by_role('button',name='Unchanged · 0 of 1',exact=True).count()==0
   await panel.get_by_role('button',name='Show Pricing 1 on the page',exact=True).click()
   assert await panel.is_visible()
   assert await panel.get_by_role('button',name='Pricing · 0 of 1',exact=True).get_attribute('aria-expanded')=='true'
   for path,name,count in pages[:3]:
    for i in range(count):
     assert await panel.get_by_role('button',name='Next',exact=True).is_disabled()
     async with context.expect_page() as opening:
      await panel.get_by_role('link',name=f'Open link to verify {name} {i+1}',exact=True).click()
     popup=await opening.value;await popup.close();await page.bring_to_front()
     await panel.get_by_role('button',name=f'Approve: {name} {i+1}',exact=True).click()
   await panel.get_by_text('5 of 5 links approved',exact=True).wait_for()
   assert await panel.get_by_role('button',name='Next',exact=True).is_enabled()
   await panel.get_by_role('button',name='Back',exact=True).click();await panel.get_by_role('button',name='Next',exact=True).click()
   await panel.get_by_text('5 of 5 links approved',exact=True).wait_for()
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(OUT/f'{width}-multi.png'))
   print(width,'five approvals across three pages, per-page grouping/net-zero, retained sheet and Back progress; Submit untouched')
  await b.close()
asyncio.run(main())
