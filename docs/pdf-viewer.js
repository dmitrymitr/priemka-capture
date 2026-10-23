'use strict';
let pdfDocument=null,pdfTask=null,pdfRender=null,pdfFile=null,pdfPage=1,pdfZoom=1,pdfGeneration=0,pdfRenderGeneration=0;
function resetPDF(){
 pdfGeneration++;pdfRenderGeneration++;pdfRender?.cancel();pdfRender=null;pdfTask?.destroy();pdfTask=null;pdfDocument=null;pdfFile=null;
 $('pdfCanvas').width=0;$('pdfCanvas').height=0;$('pdfViewer').hidden=true;
}
async function openPDF(doc){
 resetPDF();const generation=pdfGeneration;
 $('pdfViewer').hidden=false;$('pdfName').textContent=doc.name;$('pdfStatus').textContent='Открываем PDF…';$('pdfExternal').disabled=true;
 try{
  const saved=await read('media',doc.id);if(!saved?.blob)throw Error('PDF не найден на устройстве.');
  if(generation!==pdfGeneration)return;
  pdfFile=new File([saved.blob],doc.name,{type:'application/pdf'});$('pdfExternal').disabled=false;
  const pdfjs=await import('./pdf-engine.js');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdf-worker.js',location.href).href;
  const data=new Uint8Array(await pdfFile.arrayBuffer());if(generation!==pdfGeneration)return;
  pdfTask=pdfjs.getDocument({data,standardFontDataUrl:new URL('./',location.href).href,isEvalSupported:false});
  pdfTask.onPassword=(update,reason)=>{const password=prompt(reason===2?'Неверный пароль. Введи пароль PDF ещё раз:':'Введи пароль PDF:');if(password===null){resetPDF();return;}update(password);};
  const document=await pdfTask.promise;if(generation!==pdfGeneration){document.destroy();return;}
  pdfDocument=document;pdfPage=1;pdfZoom=1;await renderPDF();
  $('pdfViewer').scrollIntoView({block:'start'});
 }catch(e){if(generation===pdfGeneration)$('pdfStatus').textContent='Не удалось открыть PDF. '+e.message+' Попробуй «Открыть / поделиться PDF».';}
}
async function renderPDF(){
 if(!pdfDocument)return;
 const generation=pdfGeneration,renderGeneration=++pdfRenderGeneration;const previous=pdfRender;previous?.cancel();
 if(previous)try{await previous.promise;}catch{}
 if(renderGeneration!==pdfRenderGeneration)return;
 $('pdfPrev').disabled=pdfPage<=1;$('pdfNext').disabled=pdfPage>=pdfDocument.numPages;
 $('pdfZoomOut').disabled=pdfZoom<=1;$('pdfZoomIn').disabled=pdfZoom>=4;
 $('pdfPageLabel').textContent=`${pdfPage} / ${pdfDocument.numPages}`;$('pdfStatus').textContent='Рисуем страницу…';
 try{
  const page=await pdfDocument.getPage(pdfPage);if(generation!==pdfGeneration||renderGeneration!==pdfRenderGeneration)return;
  const base=page.getViewport({scale:1}),width=Math.max(240,$('pdfViewport').clientWidth),scale=width/base.width*pdfZoom;
  const viewport=page.getViewport({scale}),ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
  const canvas=$('pdfCanvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
  pdfRender=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});await pdfRender.promise;
  if(generation===pdfGeneration)$('pdfStatus').textContent='';
 }catch(e){if(e.name!=='RenderingCancelledException'&&generation===pdfGeneration)$('pdfStatus').textContent='Ошибка просмотра: '+e.message;}
}
function bindPDF(){
 $('pdfPrev').onclick=()=>{if(pdfPage>1){pdfPage--;renderPDF();}};
 $('pdfNext').onclick=()=>{if(pdfDocument&&pdfPage<pdfDocument.numPages){pdfPage++;renderPDF();}};
 $('pdfZoomIn').onclick=()=>{pdfZoom=Math.min(4,pdfZoom+.5);renderPDF();};
 $('pdfZoomOut').onclick=()=>{pdfZoom=Math.max(1,pdfZoom-.5);renderPDF();};
 $('pdfExternal').onclick=async()=>{
  if(!pdfFile)return;
  try{
   if(window.isPriemkaNative?.())await window.shareNativeArchive(pdfFile,pdfFile.name,{title:'План PDF',dialogTitle:'Открыть / передать PDF'});
   else if(navigator.canShare?.({files:[pdfFile]}))await navigator.share({files:[pdfFile],title:pdfFile.name});
   else downloadFile(pdfFile,pdfFile.name);
  }catch(e){if(e.name!=='AbortError')$('pdfStatus').textContent='Не удалось передать PDF: '+e.message;}
 };
}
