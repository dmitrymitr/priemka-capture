'use strict';
let activeTour=null,view='home';
const activeRoom=()=>activeTour?.rooms.find(r=>r.id===activeTour.activeRoomId);
const hasDraft=()=>!!(draft?.media.length||draft?.text.trim());
const draftOps=(value=draft,tour=activeTour)=>[{store:'state',value:{id:`draft:${tour.id}`,data:structuredClone(value)}}];
const tourOp=t=>({store:'tours',value:structuredClone(t)});
const dateLabel=value=>new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
function getTours(){return new Promise((resolve,reject)=>{const r=db.transaction('tours').objectStore('tours').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.created.localeCompare(a.created)));r.onerror=()=>reject(r.error);});}
function tourNotes(id=activeTour?.id){if(!id)return Promise.resolve([]);return new Promise((resolve,reject)=>{const r=db.transaction('notes').objectStore('notes').index('tourId').getAll(id);r.onsuccess=()=>resolve(r.result.sort((a,b)=>a.created.localeCompare(b.created)));r.onerror=()=>reject(r.error);});}

// Assign legacy observations without replacing IDs, media, text or timestamps.
// The marker, tours, note links and draft transfer commit in one transaction.
async function migrateTours(){
 if(await read('state','tours-migrated'))return;
 const old=(await allNotes()).filter(n=>!n.tourId),legacy=(await read('state','draft'))?.data;
 const groups=new Map(),ops=[];
 const getGroup=n=>{
  const key=JSON.stringify([n.object||'',n.author||'',n.section||'']);
  if(!groups.has(key))groups.set(key,{id:uid(),object:n.object||'Прежние записи',author:n.author||'',section:n.section||'',created:n.created||new Date().toISOString(),status:'completed',rooms:[],activeRoomId:null,migrated:true});
  const t=groups.get(key);if(n.created&&n.created<t.created)t.created=n.created;
  let room=t.rooms.find(r=>r.name===(n.location||'Место не указано'));
  if(!room){room={id:uid(),name:n.location||'Место не указано',created:n.created,status:'completed'};t.rooms.push(room);}
  return {t,room};
 };
 for(const n of old){const {t,room}=getGroup(n);ops.push({store:'notes',value:{...n,tourId:t.id,roomId:room.id}});}
 if(legacy&&(legacy.media?.length||legacy.text?.trim())){
  const {t,room}=getGroup(legacy);t.status='active';t.activeRoomId=room.id;room.status='active';
  ops.push(...draftOps({...legacy,tourId:t.id,roomId:room.id},t));
 }
 for(const t of groups.values())ops.push(tourOp(t));
 ops.push({store:'state',value:{id:'tours-migrated',data:true}});
 await write(ops);
}

function screen(name){view=name;for(const id of ['home','tour','capture'])$(id+'View').hidden=id!==name;msg('');window.scrollTo(0,0);}
function element(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
function button(text,action,cls='secondary'){const b=element('button',text);b.className=cls;b.onclick=()=>guarded(action);return b;}
async function guarded(action){
 if(busy||recordPending)return;
 busy=true;controls();
 try{await action();}catch(e){fail(e);}finally{busy=false;controls();}
}
async function showHome(){
 screen('home');$('toursList').replaceChildren();
 const tours=await getTours();$('emptyTours').hidden=!!tours.length;
 for(const t of tours){
  const count=(await tourNotes(t.id)).length;
  const saved=(await read('state',`draft:${t.id}`))?.data;
  const card=element('article','');card.className='tourCard';
  card.append(element('h2',t.object),element('small',`${dateLabel(t.created)} · ${t.section} · ${t.author}`),element('p',`${t.status==='completed'?'Завершён':'В работе'} · помещений: ${t.rooms.length} · замечаний: ${count}${saved&&(saved.media.length||saved.text.trim())?' · есть черновик':''}${t.migrated?' · перенесён из прежней версии':''}`),button(t.status==='completed'?'Посмотреть обход':'Открыть обход',()=>loadTour(t.id)));
  $('toursList').append(card);
 }
 await storageInfo();
}
async function loadTour(id){
 if(activeTour)await stash();
 activeTour=await read('tours',id);
 if(!activeTour)throw Error('Обход не найден. Вернись в список.');
 draft=(await read('state',`draft:${id}`))?.data||fresh(currentContext());
 await tourView();
}
async function tourView(){
 screen('tour');$('tourTitle').textContent=activeTour.object;
 $('tourMeta').textContent=`${activeTour.section} · ${activeTour.author} · ${dateLabel(activeTour.created)} · ${activeTour.status==='completed'?'Завершён':'В работе'}`;
 const editable=activeTour.status==='active';
 $('resumeRoom').hidden=!editable||!activeRoom();
 $('resumeRoom').textContent=`Продолжить: ${activeRoom()?.name||''}`;
 $('startRoom').hidden=!editable;$('endTourOverview').hidden=!editable;
 const notes=await tourNotes();$('roomsList').replaceChildren();
 for(const room of activeTour.rooms){
  const rows=notes.filter(n=>n.roomId===room.id),card=element('article','');card.className='roomCard';
  card.append(element('h3',room.name),element('p',`${room.status==='completed'?'Осмотр закончен':'В работе'} · замечаний: ${rows.length}${draft.roomId===room.id&&hasDraft()?' · есть черновик':''}`),button('Посмотреть замечания',()=>showList(room.id)));
  if(editable)card.append(button(room.id===activeTour.activeRoomId?'Продолжить':'Вернуться в помещение',()=>changeRoom(room.id)));
  $('roomsList').append(card);
 }
}
async function captureView(){
 if(activeTour.status!=='active'||!activeRoom())return tourView();
 screen('capture');$('text').value=draft.text;contextLabel();await renderMedia();await refreshCount();
 if(draft.media.some(m=>m.interrupted))msg('В черновике есть прерванная запись. Прослушай её и допиши при необходимости.',true);
}
async function prepareDraft(){
 await stopAudio();await queue;
 if(fault)throw Error('Сохранение прерывалось. Выгрузи доступные записи и перезапусти приложение.');
 if(!activeTour||activeTour.status!=='active')throw Error('Этот обход уже завершён. Начни новый обход.');
 if(hasDraft()&&!activeRoom())throw Error('Не выбрано помещение для черновика.');
 for(const m of draft.media){const saved=await read('media',m.id);if(!saved?.blob?.size)throw Error('Вложение не сохранилось полностью. Оставь черновик и попробуй перезапустить приложение.');}
}
async function commitCapture(nextTour=activeTour){
 const ops=[];
 if(hasDraft())ops.push({store:'notes',value:{...structuredClone(draft),status:'captured',finished:new Date().toISOString()}});
 const room=nextTour.rooms.find(r=>r.id===nextTour.activeRoomId);
 const next=fresh({object:nextTour.object,author:nextTour.author,section:nextTour.section,tourId:nextTour.id,roomId:room?.id||null,location:room?.name||''});
 ops.push(tourOp(nextTour),...draftOps(next,nextTour));
 await enqueue(ops);
 activeTour=nextTour;draft=next;$('text').value='';$('timer').textContent='00:00';$('record').textContent='● Начать голосовую запись';
}
async function changeRoom(existingId,newName){
 await prepareDraft();
 if(existingId===activeTour.activeRoomId)return captureView();
 const next=structuredClone(activeTour),now=new Date().toISOString();
 const previous=next.rooms.find(r=>r.id===next.activeRoomId);
 if(previous){previous.status='completed';previous.completed=now;}
 let room=next.rooms.find(r=>r.id===existingId);
 if(!room){room={id:uid(),name:newName,created:now,status:'active'};next.rooms.push(room);}
 room.status='active';delete room.completed;next.activeRoomId=room.id;
 await commitCapture(next);$('roomDialog').close();await captureView();
}
async function endRoom(){
 await prepareDraft();const next=structuredClone(activeTour),room=next.rooms.find(r=>r.id===next.activeRoomId);
 if(room){room.status='completed';room.completed=new Date().toISOString();}next.activeRoomId=null;
 await commitCapture(next);await tourView();msg('Помещение завершено. Можно начать следующее или закончить обход.');
}
async function endTour(){
 await prepareDraft();const next=structuredClone(activeTour),now=new Date().toISOString();
 for(const r of next.rooms)if(r.status==='active'){r.status='completed';r.completed=now;}
 next.activeRoomId=null;next.status='completed';next.completed=now;
 await commitCapture(next);await showHome();await exportUI();
}
async function roomDialog(){await stopAudio();await stash();$('roomName').value='';$('roomDialog').showModal();$('roomName').focus();}
function bindTours(){
 $('newTour').onclick=()=>guarded(async()=>{const ctx=(await read('state','context'))?.data||{};for(const k of fields)$(k).value=k==='location'?'':ctx[k]||'';$('newDialog').showModal();});
 $('newForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{
  const ctx=Object.fromEntries(fields.map(k=>[k,$(k).value.trim()]));if(fields.some(k=>!ctx[k]))throw Error('Заполни проект, специалиста, раздел и первое помещение.');
  const now=new Date().toISOString(),room={id:uid(),name:ctx.location,created:now,status:'active'};
  const t={id:uid(),object:ctx.object,author:ctx.author,section:ctx.section,created:now,status:'active',rooms:[room],activeRoomId:room.id};
  const d=fresh({...ctx,tourId:t.id,roomId:room.id});
  await enqueue([tourOp(t),...draftOps(d,t),{store:'state',value:{id:'context',data:ctx}}]);
  activeTour=t;draft=d;$('newDialog').close();await captureView();navigator.storage?.persist?.().catch(()=>{});
 });};
 $('roomForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{const name=$('roomName').value.trim();if(!name)throw Error('Укажи помещение.');const existing=activeTour.rooms.find(r=>r.name.toLocaleLowerCase()===name.toLocaleLowerCase());await changeRoom(existing?.id,name);$('roomDialog').close();});};
 for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>{if(!busy)$(b.dataset.close).close();};
 for(const d of document.querySelectorAll('dialog')){d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});d.addEventListener('close',()=>d.querySelector('.dialogError')?.remove());}
 $('nextRoom').onclick=()=>guarded(roomDialog);$('startRoom').onclick=()=>guarded(roomDialog);
 $('endRoom').onclick=()=>guarded(endRoom);$('endTour').onclick=()=>guarded(endTour);$('endTourOverview').onclick=()=>guarded(endTour);
 $('backTour').onclick=()=>guarded(async()=>{await stopAudio();await stash();await tourView();});
 $('homeButton').onclick=()=>guarded(async()=>{await stash();await showHome();});
 $('resumeRoom').onclick=()=>guarded(captureView);$('overviewList').onclick=()=>showList().catch(fail);
}
