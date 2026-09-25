const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const url=process.env.TEST_URL||'http://127.0.0.1:8765';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WsAAAAASUVORK5CYII=','base64');
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},permissions:['microphone'],acceptDownloads:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#newTour').waitFor();
 async function create(object,room){await page.click('#newTour');await page.fill('#object',object);await page.fill('#author','Test specialist');await page.fill('#section','АР');await page.fill('#location',room);await page.click('#saveTour');await page.locator('#captureView').waitFor({state:'visible'});}
 async function text(value){await page.fill('#text',value);await page.waitForFunction(()=>document.querySelector('#saved').textContent==='Сохранено локально');}
 async function snap(){return page.evaluate(async()=>({tours:await getTours(),notes:await allNotes(),draft,activeTour,view}));}
 await create('Test project A','Room 101');
 await page.setInputFiles('#gallery',{name:'test.png',mimeType:'image/png',buffer:png});await page.locator('#photos img').waitFor();
 await text('First room first note');await page.click('#finish');await page.waitForFunction(()=>document.querySelector('#count').textContent==='1');
 await text('Draft stays in first room');await page.click('#backTour');await page.click('#homeButton');await page.reload();
 await page.locator('.tourCard button').click();await page.click('#resumeRoom');assert.equal(await page.inputValue('#text'),'Draft stays in first room');
 await page.click('#nextRoom');await page.fill('#roomName','Room 102');await page.click('#saveRoom');await page.waitForFunction(()=>document.querySelector('#roomTitle').textContent==='Room 102');
 let data=await snap();assert.equal(data.notes.length,2);assert(data.notes.every(n=>n.location==='Room 101'));assert.equal(data.draft.location,'Room 102');
 await text('Second room note');
 // An aborted write must leave both the old room and its draft intact.
 await page.evaluate(()=>{const original=write;write=ops=>{if(ops.some(o=>o.store==='notes')){write=original;return Promise.reject(new DOMException('Simulated disk full','QuotaExceededError'));}return original(ops);};});
 await page.click('#endRoom');await page.locator('#message.error').waitFor();data=await snap();assert.equal(data.notes.length,2);assert.equal(data.activeTour.rooms.length,2);assert.equal(data.draft.text,'Second room note');
 await page.reload();await page.locator('.tourCard button').click();await page.click('#resumeRoom');assert.equal(await page.inputValue('#text'),'Second room note');
 await page.click('#endRoom');await page.locator('#tourView').waitFor({state:'visible'});data=await snap();assert.equal(data.notes.length,3);assert.equal(data.activeTour.activeRoomId,null);
 // Revisit a room without changing historical note locations.
 await page.locator('.roomCard').filter({hasText:'Room 101'}).getByRole('button',{name:'Вернуться в помещение'}).click();await page.locator('#captureView').waitFor({state:'visible'});
 await text('Return visit');await page.click('#endTour');await page.locator('#exportDialog').waitFor({state:'visible'});assert.equal(await page.locator('#homeView').isVisible(),true);
 const download=page.waitForEvent('download');await page.locator('#parts button').first().click();const d=await download;await d.saveAs(process.env.ZIP_OUTPUT||'test-tour.zip');
 await page.click('#closeExport');data=await snap();assert.equal(data.notes.length,4);assert.equal(data.tours[0].status,'completed');assert.equal(data.notes[3].location,'Room 101');
 await create('Test project B','Room B');await text('Independent draft B');await page.click('#backTour');await page.click('#homeButton');
 await page.locator('.tourCard').filter({hasText:'Test project A'}).getByRole('button').click();await page.click('#overviewList');await page.locator('#listDialog').waitFor({state:'visible'});assert.equal(await page.locator('#records article').count(),4);await page.locator('#records button').first().click();await page.locator('#records img').waitFor();assert.equal(await page.locator('#records img').count(),1);await page.click('#closeList');
 await page.click('#homeButton');await page.locator('.tourCard').filter({hasText:'Test project B'}).getByRole('button').click();await page.click('#resumeRoom');assert.equal(await page.inputValue('#text'),'Independent draft B');
 // Finishing an active voice recording during a room transition saves it to the old room.
 await page.click('#record');await page.waitForFunction(()=>!!recorder&&recorder.state==='recording');await page.waitForTimeout(1200);
 await page.click('#nextRoom');await page.fill('#roomName','Room C');await page.click('#saveRoom');await page.waitForFunction(()=>document.querySelector('#roomTitle').textContent==='Room C');data=await snap();const audioNote=data.notes.find(n=>n.object==='Test project B');assert.equal(audioNote.location,'Room B');assert(audioNote.media.some(m=>m.kind==='audio'&&m.size>0));
 // Empty room / tour completion must not manufacture observations.
 await page.click('#endTour');await page.locator('#exportDialog').waitFor({state:'visible'});await page.click('#closeExport');data=await snap();assert.equal(data.notes.length,5);
 await create('No findings','Empty room');await page.click('#endTour');await page.locator('#exportDialog').waitFor({state:'visible'});assert.match(await page.locator('#parts').innerText(),/0 замечаний/);await page.click('#closeExport');
 await page.screenshot({path:process.env.SCREEN_OUTPUT||'test-home.png',fullPage:true});
 // Service-worker shell really survives offline reload.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await context.setOffline(true);await page.reload();await page.locator('.tourCard').first().waitFor();assert.equal(await page.locator('.tourCard').count(),3);await context.setOffline(false);
 assert.deepEqual(errors,[]);await context.close();

 // Seed the old IndexedDB schema and check migration exactly once, with original blobs and IDs.
 const legacy=await browser.newContext();const old=await legacy.newPage();await old.route('**/app.js',r=>r.fulfill({body:''}));await old.goto(url);
 await old.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('priemka-capture-v1',1);r.onupgradeneeded=()=>{for(const n of ['state','notes','media'])r.result.createObjectStore(n,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['state','notes','media'],'readwrite');const base={object:'Legacy object',author:'Legacy author',section:'КР',location:'Legacy room',created:'2026-09-24T10:00:00Z',interrupted:false};
   tx.objectStore('notes').put({...base,id:'old-note',status:'captured',text:'Original text',media:[{id:'old-photo',kind:'photo',ext:'png',size:3}]});
   tx.objectStore('media').put({id:'old-photo',blob:new Blob(['abc'])});
   tx.objectStore('state').put({id:'draft',data:{...base,id:'old-draft',status:'draft',text:'Original draft',media:[]}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 });
 await old.unroute('**/app.js');await old.reload();await old.locator('.tourCard').waitFor();
 let migrated=await old.evaluate(async()=>({notes:await allNotes(),tours:await getTours(),blob:await(await read('media','old-photo')).blob.text()}));
 assert.equal(migrated.notes[0].id,'old-note');assert.equal(migrated.notes[0].text,'Original text');assert.equal(migrated.blob,'abc');assert.equal(migrated.tours.length,1);
 await old.locator('.tourCard button').click();await old.click('#resumeRoom');assert.equal(await old.inputValue('#text'),'Original draft');await old.reload();await old.locator('.tourCard').waitFor();assert.equal(await old.evaluate(async()=>(await getTours()).length),1);
 await legacy.close();
 console.log('PASS: room transitions, revisit, draft recovery, failed-save recovery, tour isolation, photo review, live audio transition, ZIP download, empty tours, offline reload, v1 migration and idempotence.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
