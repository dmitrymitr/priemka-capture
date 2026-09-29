'use strict';
let editing=null,editorURLs=[],listRoomFilter=null,editorReturnList=false;
function editorDirty(){return editing&&(editing.text!==$('editText').value||editing.roomId!==$('editRoom').value||$('editNewRoom').value.trim()||editing.changed);}
function updateEditorRoom(){ $('editNewRoomLabel').hidden=$('editRoom').value!=='__new'; }
async function openEditor(noteId=null,roomId=null,fromList=false){
 await queue;
 const original=noteId?await read('notes',noteId):null;
 if(noteId&&(!original||original.tourId!==activeTour.id))throw Error('Замечание не найдено в этом обходе.');
 editing=original?structuredClone(original):fresh({object:activeTour.object,author:activeTour.author,section:activeTour.section,tourId:activeTour.id,roomId:roomId||activeTour.activeRoomId||activeTour.rooms[0]?.id,location:''});
 editing.isNew=!original;editing.pendingBlobs=new Map();editing.changed=false;editorReturnList=fromList;
 $('editTitle').textContent=original?'Редактировать замечание':'Добавить замечание';
 $('editText').value=editing.text;$('editNewRoom').value='';$('editRoom').replaceChildren();
 for(const r of activeTour.rooms){const o=element('option',r.name);o.value=r.id;$('editRoom').append(o);}
 const option=element('option','＋ Новое помещение');option.value='__new';$('editRoom').append(option);
 $('editRoom').value=editing.roomId||'__new';updateEditorRoom();
 $('listDialog').close();await renderEditorMedia();$('editDialog').showModal();
}
async function renderEditorMedia(){
 revoke(editorURLs);$('editMedia').replaceChildren();
 for(const m of editing.media){
  const blob=editing.pendingBlobs.get(m.id)||(await read('media',m.id))?.blob;if(!blob)throw Error('Не найдено вложение замечания. Сохранение отменено.');
  const url=URL.createObjectURL(blob);editorURLs.push(url);
  const box=element('div','');box.className='editAttachment';
  const media=document.createElement(m.kind==='photo'?'img':'audio');media.src=url;
  if(m.kind==='photo')media.alt='Фото замечания';else media.controls=true;
  box.append(media,button('Убрать вложение',async()=>{editing.media=editing.media.filter(x=>x.id!==m.id);editing.pendingBlobs.delete(m.id);editing.changed=true;await renderEditorMedia();},'plain'));
  $('editMedia').append(box);
 }
}
async function editorPhotos(files){
 await guarded(async()=>{
  for(const file of files){
   if(!file.type.startsWith('image/'))throw Error('Выбери фотографию.');
   if(file.size>80*1024*1024)throw Error('Снимок больше 80 МБ. Выбери меньший файл.');
   const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'})[file.type]||'img';
   const m={id:uid(),kind:'photo',ext,type:file.type,size:file.size,originalName:file.name};
   editing.media.push(m);editing.pendingBlobs.set(m.id,file);editing.changed=true;
  }
  await renderEditorMedia();
 });
}
// Blobs may be referenced by migrated notes or a draft. Never remove a shared blob.
async function unusedMediaOps(ids,excludedNote){
 const used=new Set((await allNotes()).filter(n=>n.id!==excludedNote).flatMap(n=>n.media.map(m=>m.id)));
 const states=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 for(const s of states)for(const m of s.data?.media||[])used.add(m.id);
 return ids.filter(id=>!used.has(id)).map(id=>({store:'media',id,delete:true}));
}
async function saveEditor(){
 if(!editing)return;
 const text=$('editText').value.trim();
 if(!text&&!editing.media.length)throw Error('Добавь фото или текст. Для удаления используй кнопку «Удалить».');
 const next=structuredClone(activeTour),now=new Date().toISOString();let room;
 if($('editRoom').value==='__new'){
  const name=$('editNewRoom').value.trim();if(!name)throw Error('Укажи помещение.');
  room=next.rooms.find(r=>r.name.toLocaleLowerCase()===name.toLocaleLowerCase());
  if(!room){room={id:uid(),name,created:now,status:'completed',completed:now};next.rooms.push(room);}
 }else room=next.rooms.find(r=>r.id===$('editRoom').value);
 if(!room)throw Error('Выбери помещение.');
 const original=editing.isNew?null:await read('notes',editing.id);
 if(!editing.isNew&&!original)throw Error('Замечание уже удалено. Закрой карточку и обнови список.');
 const {pendingBlobs,isNew,changed,...data}=editing;
 const note={...data,text,roomId:room.id,location:room.name,status:'captured',finished:original?.finished||now,updated:now};
 const ops=[];
 for(const m of note.media){
  const blob=pendingBlobs.get(m.id)||(await read('media',m.id))?.blob;
  if(!blob?.size)throw Error('Вложение не сохранилось полностью.');
  if(pendingBlobs.has(m.id))ops.push({store:'media',value:{id:m.id,blob}});
 }
 const removed=(original?.media||[]).filter(m=>!note.media.some(x=>x.id===m.id)).map(m=>m.id);
 ops.push(...await unusedMediaOps(removed,note.id));next.updated=now;
 ops.push({store:'notes',value:note},tourOp(next));
 await enqueue(ops);activeTour=next;
 const fromList=editorReturnList;editing=null;$('editDialog').close();revoke(editorURLs);
 if(view==='tour')await tourView();else if(view==='capture')await refreshCount();
 if(fromList)await showList();
 msg('Изменения сохранены. Для передачи исправлений выгрузи новый ZIP.');
}
async function cancelEditor(){
 if(editorDirty()&&!confirm('Закрыть без сохранения изменений?'))return;
 editing=null;$('editDialog').close();revoke(editorURLs);
 if(editorReturnList)await showList(listRoomFilter);
}
async function deleteNote(id){
 const n=await read('notes',id);if(!n||n.tourId!==activeTour.id)throw Error('Замечание не найдено.');
 if(!confirm(`Удалить замечание из помещения «${n.location}»?\n${n.text.slice(0,180)||'Замечание с вложениями'}\nЭто действие нельзя отменить.`))return;
 const now=new Date().toISOString(),next=structuredClone(activeTour);
 next.updated=now;next.deletedNotes=[...(next.deletedNotes||[]),{id:n.id,deletedAt:now}];
 await enqueue([{store:'notes',id,delete:true},...await unusedMediaOps(n.media.map(m=>m.id),id),tourOp(next)]);
 activeTour=next;
 if(view==='tour')await tourView();else if(view==='capture')await refreshCount();
 await showList(listRoomFilter);msg('Замечание удалено. Выгрузи новый ZIP для передачи актуального обхода.');
}
function bindEditor(){
 $('editRoom').onchange=updateEditorRoom;
 $('editForm').onsubmit=e=>{e.preventDefault();guarded(saveEditor);};
 $('editCancel').onclick=()=>guarded(cancelEditor);
 $('editDialog').addEventListener('cancel',e=>{e.preventDefault();if(!busy)guarded(cancelEditor);});
 $('editCameraButton').onclick=()=>$('editCamera').click();$('editGalleryButton').onclick=()=>$('editGallery').click();
 for(const id of ['editCamera','editGallery'])$(id).onchange=async e=>{await editorPhotos([...e.target.files]);e.target.value='';};
 $('addNote').onclick=()=>guarded(()=>openEditor());
 $('listAddNote').onclick=()=>guarded(()=>openEditor(null,listRoomFilter,true));
}
