const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WsAAAAASUVORK5CYII=','base64');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.env.TEST_URL||'http://127.0.0.1:8765');await p.click('#newTour');
 await p.fill('#object','Revision 1');await p.fill('#author','Engineer');await p.fill('#section','АР');await p.fill('#location','101');await p.click('#saveTour');
 await p.locator('#captureView').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#takePhoto').disabled);
 await p.setInputFiles('#camera',{name:'one.png',mimeType:'image/png',buffer:png});await p.locator('#photos img').waitFor();
 await p.fill('#text','Original');await p.click('#finish');await p.waitForFunction(()=>document.querySelector('#count').textContent==='1');
 await p.fill('#text','Second');await p.click('#endTour');await p.locator('#exportDialog').waitFor({state:'visible'});await p.click('#closeExport');
 const original=await p.evaluate(async()=>(await allNotes())[0]);
 await p.locator('.tourCard button').click();await p.click('#overviewList');
 const first=()=>p.locator(`#records article[data-note-id="${original.id}"]`);
 await first().getByRole('button',{name:'Редактировать',exact:true}).click();await p.fill('#editText','Changed');
 await p.selectOption('#editRoom','__new');await p.fill('#editNewRoom','102');
 await p.setInputFiles('#editGallery',{name:'two.png',mimeType:'image/png',buffer:png});await p.waitForFunction(()=>document.querySelectorAll('#editMedia img').length===2);
 await p.click('#editSave');await p.locator('#editDialog').waitFor({state:'hidden'});
 let data=await p.evaluate(async()=>({notes:await allNotes(),t:activeTour}));
 assert.equal(data.notes[0].id,original.id);assert.equal(data.notes[0].created,original.created);assert.equal(data.notes[0].text,'Changed');assert.equal(data.notes[0].location,'102');assert.equal(data.notes[0].media.length,2);assert.equal(data.t.status,'completed');assert(data.notes[0].updated);
 // Cancelling edits leaves original text and attachments unchanged.
 await first().getByRole('button',{name:'Редактировать',exact:true}).click();await p.fill('#editText','Discard');
 await p.locator('#editMedia button').first().click();p.once('dialog',d=>d.accept());await p.click('#editCancel');
 assert.equal(await p.evaluate(async id=>(await read('notes',id)).text,original.id),'Changed');
 assert.equal(await p.evaluate(async id=>(await read('notes',id)).media.length,original.id),2);
 // Failed transaction must not overwrite note, remove blobs or create a room.
 await first().getByRole('button',{name:'Редактировать',exact:true}).click();await p.fill('#editText','Fail');
 await p.locator('#editMedia button').first().click();
 await p.evaluate(()=>{const prev=write;write=ops=>{write=prev;return Promise.reject(Error('Simulated write failure'));};});
 await p.click('#editSave');await p.locator('#editDialog .dialogError').waitFor();
 assert.equal(await p.evaluate(async id=>(await read('notes',id)).text,original.id),'Changed');
 assert(await p.evaluate(async id=>!!(await read('media',id)),original.media[0].id));
 p.once('dialog',d=>d.accept());await p.click('#editCancel');
 // Retry in a fresh session and delete an attachment, then add to a completed tour.
 await p.reload();await p.locator('.tourCard button').click();await p.click('#overviewList');
 await first().getByRole('button',{name:'Редактировать',exact:true}).click();await p.locator('#editMedia button').first().click();await p.click('#editSave');await p.locator('#editDialog').waitFor({state:'hidden'});
 assert.equal(await p.evaluate(async id=>!!(await read('media',id)),original.media[0].id),false);
 await p.click('#listAddNote');await p.fill('#editText','Added after completion');await p.click('#editSave');await p.locator('#editDialog').waitFor({state:'hidden'});
 assert.equal(await p.locator('#records article').count(),3);
 // Deletion can be cancelled, then confirmed; the export records a tombstone.
 await Promise.all([p.waitForEvent('dialog').then(d=>d.dismiss()),first().getByRole('button',{name:'Удалить',exact:true}).click()]);assert.equal(await p.locator('#records article').count(),3);
 await Promise.all([p.waitForEvent('dialog').then(d=>d.accept()),first().getByRole('button',{name:'Удалить',exact:true}).click()]);await p.waitForFunction(()=>document.querySelectorAll('#records article').length===2);
 assert.equal(await p.evaluate(async id=>!!(await read('notes',id)),original.id),false);
 assert.equal(await p.evaluate(id=>activeTour.deletedNotes[0].id,original.id),original.id);
 await p.click('#closeList');await p.click('#export');const download=p.waitForEvent('download');await p.locator('#parts button').first().click();const downloaded=await download;assert.match(downloaded.suggestedFilename(),/^Revision 1_\d{2}\.\d{2}\.\d{4}_АР_обход-[a-f0-9]{8}_часть-1\.zip$/);await downloaded.saveAs(process.env.REVISION_ZIP_OUTPUT||'revision1.zip');await p.click('#closeExport');
 const names=await p.evaluate(()=>[archiveName({object:'ФФЦ Казань',section:'АР',created:'2026-09-29T12:00:00Z',id:'842511dd-123'},2),archiveName({object:'../<>:*?"|\\/'+ '🧱'.repeat(200),section:'ОВ/иК'+ 'Я'.repeat(150),created:'2026-09-29T12:00:00Z',id:'12345678'},1)]);
 assert.equal(names[0],'ФФЦ Казань_29.09.2026_АР_обход-842511dd_часть-2.zip');assert(!/[<>:"/\\|?*]/.test(names[1]));assert(Buffer.byteLength(names[1],'utf8')<255);
 // An active capture draft survives editing another saved note.
 await p.click('#homeButton');await p.click('#newTour');await p.fill('#object','Active');await p.fill('#location','A');await p.click('#saveTour');
 await p.fill('#text','Saved active note');await p.click('#finish');await p.waitForFunction(()=>document.querySelector('#count').textContent==='1');await p.fill('#text','Active draft stays');
 await p.click('#showList');await p.getByRole('button',{name:'Редактировать',exact:true}).click();await p.fill('#editText','Edited active note');await p.click('#editSave');await p.locator('#editDialog').waitFor({state:'hidden'});await p.click('#closeList');
 assert.equal(await p.inputValue('#text'),'Active draft stays');
 // Offline edits after reload use the same database and cached editor.
 await p.click('#backTour');await p.click('#homeButton');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await context.setOffline(true);await p.reload();
 await p.locator('.tourCard').filter({hasText:'Revision 1'}).getByRole('button').click();await p.click('#addNote');await p.fill('#editText','Offline addition');await p.click('#editSave');await p.locator('#editDialog').waitFor({state:'hidden'});
 assert.equal(await p.evaluate(async()=>(await tourNotes()).length),3);
 await p.screenshot({path:process.env.REVISION_SCREEN_OUTPUT||'revision1.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: edit completed tours, photo changes, cancel, failed write, delete confirmation, tombstones, add completed notes, draft isolation and offline editing.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
