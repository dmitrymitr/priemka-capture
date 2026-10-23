'use strict';
let preferences={typical:false,burst:false},pdfURLs=[],shareURLs=[],shareFiles=[],photoShareItems=[],cameraStream=null,cameraForEditor=false,cameraBusy=false,pdfTourId=null;
async function loadPreferences(){preferences={...preferences,...(await read('state','preferences'))?.data};}
function tourOption(key){return activeTour?.options?.[key]??preferences[key];}
function rememberSession(name){try{localStorage.setItem('priemka-session',JSON.stringify({tourId:activeTour?.id,view:name}));}catch{}}
function snapshotDraft(){
 if(!activeTour||!draft)return;
 // Synchronous text fallback survives Safari freezing the page before IDB finishes.
 try{localStorage.setItem('priemka-draft:'+activeTour.id,JSON.stringify({...draft,recoveryAt:Date.now()}));}catch(e){msg('Не удалось создать аварийную копию текста. Дождись надписи «Сохранено локально».',true);}
}
function clearSnapshot(id){try{localStorage.removeItem('priemka-draft:'+id);}catch{}}
async function recoverDraft(){
 let saved;try{saved=JSON.parse(localStorage.getItem('priemka-draft:'+activeTour.id)||'null');}catch{return;}
 // A different ID means a completed/deleted draft; never resurrect it.
 if(!saved||saved.id!==draft.id)return;
 const media=[];for(const item of saved.media||[])if((await read('media',item.id))?.blob)media.push(item);
 draft={...draft,text:saved.text??draft.text,media};await enqueue(draftOps());
}
async function restoreSession(){
 let s;try{s=JSON.parse(localStorage.getItem('priemka-session')||'null');}catch{return;}
 if(!s?.tourId||s.view==='home'||!await read('tours',s.tourId))return;
 await loadTour(s.tourId);if(s.view==='capture'&&activeTour.status==='active')await captureView();
}
function updateRevisionContext(){const visible=!!activeTour&&view!=='home';$('documentsButton').hidden=!visible;$('changeSection').hidden=!visible||activeTour.status!=='active';$('changeSection').textContent='Раздел: '+(activeTour?.section||'')+' ▾';}
async function removeDraftPhoto(id){
 const next=structuredClone(draft);next.media=next.media.filter(m=>m.id!==id);
 await enqueue(draftOps(next));draft=next;snapshotDraft();await enqueue(await unusedMediaOps([id]));await renderMedia();
}
function violationMatches(text){
 const normalize=x=>x.toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^а-яa-z0-9]+/g,' ').trim();
 const q=normalize(text);if(q.length<2)return [];
 const words=q.split(' ').filter(w=>w.length>1);
 return PB_CATALOG.map(item=>{const short=normalize(item.short),full=normalize(item.full),tokens=(short+' '+full).split(' ');const score=(short===q?100:short.includes(q)?60:0)+words.reduce((s,w)=>s+(tokens.some(t=>t.startsWith(w))?3:0),0);return {...item,score};}).filter(x=>x.score>=Math.max(3,words.length*2)).sort((a,b)=>b.score-a.score).slice(0,5);
}
function suggestViolations(field,target){
 const box=$(target);box.replaceChildren();if(!tourOption('typical'))return;
 for(const item of violationMatches($(field).value)){
  const b=element('button',`${item.short} — ${item.full}`);b.type='button';b.className='secondary';
  b.onclick=()=>{ $(field).value=item.full;if(field==='text'){draft.text=item.full;draft.typicalId=item.id;stash().catch(fail);}else editing.changed=true;box.replaceChildren();$(field).focus();};box.append(b);
 }
}
async function preparePDFs(files,tour){
 const ops=[];tour.documents=[...(tour.documents||[])];
 for(const file of files){if(!file.name.toLowerCase().endsWith('.pdf')||await file.slice(0,5).text()!=='%PDF-')throw Error('Выбери корректный PDF-файл.');if(file.size>100*1048576)throw Error('PDF больше 100 МБ. Раздели его на части.');const id=uid();tour.documents.push({id,name:file.name,size:file.size});ops.push({store:'media',value:{id,blob:file}});}
 return ops;
}
async function showDocuments(){
 await stash();if(pdfTourId!==activeTour.id){pdfTourId=activeTour.id;resetPDF();$('pdfViewer').hidden=true;revoke(pdfURLs);}$('pdfList').replaceChildren();
 for(const doc of activeTour.documents||[]){
  const row=element('div','');row.className='actions';row.append(button(doc.name,async()=>{
   await openPDF(doc);
  }),button('Удалить PDF',async()=>{if(!confirm('Удалить этот PDF из обхода?'))return;const next=structuredClone(activeTour);next.documents=next.documents.filter(d=>d.id!==doc.id);await enqueue([tourOp(next),{store:'media',id:doc.id,delete:true}]);activeTour=next;resetPDF();$('pdfViewer').hidden=true;revoke(pdfURLs);await showDocuments();},'plain'));$('pdfList').append(row);
 }
 if(!activeTour.documents?.length)$('pdfList').textContent='Документов пока нет. Добавь PDF с планировками.';
 if(!$('documentsDialog').open)$('documentsDialog').showModal();
}
async function startPhotoCapture(editor){
 if(!tourOption('burst')){$(editor?'editCamera':'camera').click();return;}
 cameraForEditor=editor;$('burstStatus').textContent='Запускаем камеру…';$('burstShot').disabled=true;$('burstDialog').showModal();
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Встроенная камера недоступна. Используй обычную камеру.');
  cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1920}},audio:false});
  if(!$('burstDialog').open){stopBurst();return;}
  $('burstVideo').srcObject=cameraStream;await $('burstVideo').play();$('burstStatus').textContent='Снимай подряд. Каждый кадр добавляется к замечанию.';$('burstShot').disabled=false;
 }catch(e){stopBurst();$('burstStatus').textContent='Камера недоступна: '+e.message+' Нажми «Обычная камера».';}
}
function stopBurst(){cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;$('burstVideo').srcObject=null;}
async function burstShot(){
 if(cameraBusy)return;cameraBusy=true;$('burstShot').disabled=true;$('burstDone').disabled=true;$('burstFallback').disabled=true;
 try{
  const video=$('burstVideo');if(!video.videoWidth)throw Error('Камера ещё не готова.');const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error('Не удалось получить фото.');
  const file=new File([blob],`Фото-${Date.now()}.jpg`,{type:'image/jpeg'});
  if(cameraForEditor)await editorPhotos([file]);else if(await addPhotos([file])===false)throw Error('Фото не сохранено. Проверь доступную память.');
  $('burstStatus').textContent=`Фото добавлено · ${cameraForEditor?editing.media.length:draft.media.length} вложений`;
 }catch(e){$('burstStatus').textContent=e.message;}finally{cameraBusy=false;$('burstShot').disabled=false;$('burstDone').disabled=false;$('burstFallback').disabled=false;}
}
async function preparePhotoShare(note){
 photoShareItems=note.media.filter(m=>m.kind==='photo');if(!photoShareItems.length)throw Error('В этой записи нет фотографий.');
 $('photoBatch').replaceChildren();const count=Math.ceil(photoShareItems.length/20);$('photoBatchLabel').hidden=count<2;for(let i=0;i<count;i++){const option=element('option',`Часть ${i+1} из ${count}`);option.value=i;$('photoBatch').append(option);}
 await renderPhotoBatch(0);$('photoShareDialog').showModal();
}
async function renderPhotoBatch(part){
 shareFiles=[];revoke(shareURLs);$('shareImageList').replaceChildren();
 for(const item of photoShareItems.slice(part*20,(part+1)*20)){const saved=await read('media',item.id);if(!saved)throw Error('Фото не найдено.');const file=new File([saved.blob],`Фото-${shareFiles.length+1}.${item.ext}`,{type:item.type||saved.blob.type});shareFiles.push(file);const url=URL.createObjectURL(file);shareURLs.push(url);const link=element('a','');link.href=url;link.target='_blank';const img=element('img','');img.src=url;img.alt=file.name;link.append(img);$('shareImageList').append(link);}
 if(!shareFiles.length)throw Error('В этой записи нет фотографий.');
 $('shareImages').hidden=!navigator.canShare?.({files:shareFiles});
}
function archiveName(tour,part,total=1){
 const clean=(value,fallback,max)=>{const s=String(value||'').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'-').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');let out='';for(const c of s){if(new TextEncoder().encode(out+c).length>max)break;out+=c;}return out||fallback;};
 const date=new Date(tour.created),pad=n=>String(n).padStart(2,'0');const day=Number.isNaN(+date)?'без-даты':`${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()}`;
 return `${clean(tour.object,'Объект',90)}_${day}_${clean(tour.section,'Раздел',40)}_ч.${part} из ${total}.zip`;
}
function exportGroups(notes){
 const sections=new Map();for(const note of notes){const key=note.section||'Без раздела';if(!sections.has(key))sections.set(key,[]);sections.get(key).push(note);}
 const result=[];for(const [section,rows] of sections){const parts=[];let group=[],size=0;for(const n of rows){const bytes=n.media.reduce((s,m)=>s+m.size,0);if(group.length&&(group.length>=25||size+bytes>150*1048576)){parts.push(group);group=[];size=0;}group.push(n);size+=bytes;}if(group.length)parts.push(group);parts.forEach((g,i)=>result.push({section,notes:g,part:i+1,total:parts.length}));}return result;
}
function downloadFile(blob,name){const url=URL.createObjectURL(blob),a=element('a','');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);}
async function exportPart(notes,part,tour,total=1){
 const workbook=await makeDefectWorkbook(notes,tour);const name=archiveName(tour,part,total);
 const zip=await makeZip([{name:name.replace(/\.zip$/,'.xlsx'),blob:workbook}]);
 if(window.isPriemkaNative?.())await window.shareNativeArchive(zip,name);else downloadFile(zip,name);return zip.size;
}
async function exportUI(){
 await stash();await queue;if(fault)throw Error('Ошибка сохранения. Проверь данные перед выгрузкой.');
 const tour=structuredClone(activeTour),notes=await tourNotes();if(hasDraft())notes.push(structuredClone(draft));const groups=exportGroups(notes);
 $('exportTitle').textContent=`Передать обход: ${tour.object}`;$('parts').replaceChildren();
 if(!groups.length)$('parts').textContent='В обходе пока нет записей.';
 for(const group of groups){
  const box=element('div','');box.className='exportPart';box.append(element('p',`${group.section} · часть ${group.part} из ${group.total} · записей: ${group.notes.length}`));
  const b=element('button','Подготовить Excel и ZIP');b.className='finish';box.append(b);
  b.onclick=async()=>{b.disabled=true;b.textContent='Собираем Excel с фотографиями…';try{
   const t={...tour,section:group.section};const workbook=await makeDefectWorkbook(group.notes,t);const name=archiveName(t,group.part,group.total);const zip=await makeZip([{name:name.replace(/\.zip$/,'.xlsx'),blob:workbook}]);b.textContent=`Готово · ${(zip.size/1048576).toFixed(1)} МБ`;
   const save=element('button','1. Скачать ZIP');save.className='secondary';save.onclick=()=>downloadFile(zip,name);
   const preview=element('button','2. Посмотреть / скачать Excel');preview.className='secondary';preview.onclick=()=>downloadFile(workbook,name.replace(/\.zip$/,'.xlsx'));
   const share=element('button','3. Передать / поделиться ZIP');share.className='secondary';const file=new File([zip],name,{type:'application/zip'});
   share.onclick=async()=>{try{if(window.isPriemkaNative?.())await window.shareNativeArchive(zip,name);else if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:tour.object});else {downloadFile(zip,name);msg('Файл скачан. Открой «Загрузки», выбери ZIP → «Поделиться».');}}catch(e){if(e.name!=='AbortError')fail(e);}};
   box.append(save,preview,share);
  }catch(e){b.disabled=false;b.textContent='Повторить подготовку';box.append(element('p',e.message));fail(e);}};
  $('parts').append(box);
 }
 $('exportDialog').showModal();
}
async function showStorage(){
 await queue;$('storageTours').replaceChildren();const notes=await allNotes();
 for(const t of await getTours()){
  const rows=notes.filter(n=>n.tourId===t.id),d=(await read('state',`draft:${t.id}`))?.data;
  const bytes=[...rows.flatMap(n=>n.media),...(d?.media||[]),...(t.documents||[])].reduce((s,m)=>s+(m.size||0),0);
  const box=element('article','');box.append(element('h3',t.object),element('p',`${dateLabel(t.created)} · ${t.status==='completed'?'Завершён':'В работе'} · ${rows.length} записей · вложения ${(bytes/1048576).toFixed(1)} МБ`));
  box.append(button('Удалить обход с устройства',async()=>{if(!confirm(`Удалить обход «${t.object}» от ${dateLabel(t.created)}?\nПроверь, что нужные фото и ведомость уже переданы. Excel не сохраняет прежние аудио и PDF.\nУдалятся все записи и вложения этого обхода. Отменить нельзя.`))return;await deleteTourData(t.id);await showStorage();},'danger'));$('storageTours').append(box);
 }
 if(!$('storageDialog').open)$('storageDialog').showModal();
}
async function deleteTourData(id){
 await queue;const tours=await getTours(),notes=await allNotes();const states=await new Promise((resolve,reject)=>{const q=db.transaction('state').objectStore('state').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 const target=tours.find(t=>t.id===id);if(!target)return;
 const own=notes.filter(n=>n.tourId===id),other=notes.filter(n=>n.tourId!==id);const d=states.find(s=>s.id===`draft:${id}`)?.data;
 const candidates=new Set([...own.flatMap(n=>n.media.map(m=>m.id)),...(d?.media||[]).map(m=>m.id),...(target.documents||[]).map(m=>m.id)]);
 const used=new Set([...other.flatMap(n=>n.media.map(m=>m.id)),...states.filter(s=>s.id!==`draft:${id}`).flatMap(s=>(s.data?.media||[]).map(m=>m.id)),...tours.filter(t=>t.id!==id).flatMap(t=>(t.documents||[]).map(m=>m.id))]);
 const ops=[{store:'tours',id,delete:true},{store:'state',id:`draft:${id}`,delete:true},...own.map(n=>({store:'notes',id:n.id,delete:true})),...[...candidates].filter(m=>!used.has(m)).map(m=>({store:'media',id:m,delete:true}))];
 await enqueue(ops);clearSnapshot(id);if(activeTour?.id===id){activeTour=null;draft=fresh({});}await showHome();updateRevisionContext();
}
function bindRevision(){
 // Keep the last session before showHome writes a new navigation state.
 let resume;try{resume=localStorage.getItem('priemka-session');}catch{}
 const originalRestore=restoreSession;restoreSession=async()=>{if(resume)try{localStorage.setItem('priemka-session',resume);}catch{}await originalRestore();};
 const originalScreen=screen;screen=name=>{originalScreen(name);updateRevisionContext();};
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(view==='capture'&&activeTour){draft.text=$('text').value;snapshotDraft();stash().catch(fail);}stopBurst();}else if($('burstDialog').open&&!cameraStream){$('burstStatus').textContent='Камера остановлена после сворачивания. Закрой окно и открой съёмку снова.';}});
 window.addEventListener('pagehide',()=>{if(view==='capture'&&activeTour){draft.text=$('text').value;snapshotDraft();}stopBurst();});
 $('settingsButton').onclick=()=>{ $('prefTypical').checked=preferences.typical;$('prefBurst').checked=preferences.burst;$('tourOptions').hidden=!activeTour||view==='home';$('tourTypical').checked=tourOption('typical');$('tourBurst').checked=tourOption('burst');$('settingsDialog').showModal();};
 $('saveSettings').onclick=()=>guarded(async()=>{const next={typical:$('prefTypical').checked,burst:$('prefBurst').checked};const ops=[{store:'state',value:{id:'preferences',data:next}}];let tour;if(activeTour&&view!=='home'){tour=structuredClone(activeTour);tour.options={typical:$('tourTypical').checked,burst:$('tourBurst').checked};ops.push(tourOp(tour));}await enqueue(ops);preferences=next;if(tour)activeTour=tour;$('settingsDialog').close();suggestViolations('text','suggestions');});
 $('documentsButton').onclick=()=>guarded(showDocuments);$('closeDocuments').onclick=()=>$('documentsDialog').close();
 bindPDF();
 $('addPDFs').onchange=e=>guarded(async()=>{const next=structuredClone(activeTour);const ops=await preparePDFs([...e.target.files],next);await enqueue([...ops,tourOp(next)]);activeTour=next;e.target.value='';await showDocuments();});
 $('changeSection').onclick=()=>{$('nextSection').value=activeTour.section;$('sectionDialog').showModal();};
 $('sectionForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{const section=$('nextSection').value.trim();if(!section)throw Error('Укажи раздел.');await prepareDraft();const next=structuredClone(activeTour);next.section=section;await commitCapture(next);$('sectionDialog').close();await captureView();});};
 $('burstShot').onclick=burstShot;$('burstDone').onclick=()=>{if(!cameraBusy)$('burstDialog').close();};$('burstDialog').addEventListener('close',stopBurst);$('burstDialog').addEventListener('cancel',e=>{if(cameraBusy)e.preventDefault();});
 $('burstFallback').onclick=()=>{if(cameraBusy)return;$('burstDialog').close();$(cameraForEditor?'editCamera':'camera').click();};
 $('tourPhotos').onclick=()=>guarded(async()=>{const notes=await tourNotes();const media=[...notes.flatMap(n=>n.media),...(draft?.media||[])];await preparePhotoShare({media});});
 $('manageStorage').onclick=()=>guarded(showStorage);
 $('photoBatch').onchange=()=>guarded(()=>renderPhotoBatch(Number($('photoBatch').value)));
 $('shareImages').onclick=async()=>{try{await navigator.share({files:shareFiles});}catch(e){if(e.name!=='AbortError')fail(e);}};
 $('photoShareDialog').addEventListener('close',()=>{revoke(shareURLs);shareFiles=[];});
}
