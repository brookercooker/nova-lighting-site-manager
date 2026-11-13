import asyncio
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True)
  context=await b.new_context(viewport={'width':1280,'height':1800})
  page=await context.new_page()
  await page.route('https://parent.example/**',lambda r:r.fulfill(body="<iframe src='https://child.example/'></iframe><script>addEventListener('message',e=>{if(e.data==='open'){document.body.dataset.activation=String(navigator.userActivation.isActive);window.open('https://destination.example/','_blank','noopener,noreferrer')}})</script>",content_type='text/html'))
  await page.route('https://child.example/**',lambda r:r.fulfill(body="<button onclick=\"parent.postMessage('open','https://parent.example')\">Parent Fallback</button><a target='_blank' rel='noopener noreferrer' href='https://destination.example/'>Synchronous Public Anchor</a>",content_type='text/html'))
  await page.route('https://destination.example/**',lambda r:r.fulfill(body='<h1>Verified</h1>',content_type='text/html'))
  await page.goto('https://parent.example/')
  f=page.frame_locator('iframe')
  async with context.expect_page() as opening: await f.get_by_role('button',name='Parent Fallback').click()
  tab=await opening.value;await tab.wait_for_load_state();assert await tab.evaluate('opener===null');await tab.close()
  print('Chromium real cross-origin postMessage fallback opened; parent activation=',await page.locator('body').get_attribute('data-activation'))
  async with context.expect_page() as opening: await f.get_by_role('link',name='Synchronous Public Anchor').click()
  tab=await opening.value;await tab.wait_for_load_state();assert await tab.evaluate('opener===null');await tab.close()
  print('Synchronous child anchor opened with no opener; browser-specific popup restrictions still apply.')
  await b.close()
asyncio.run(main())
