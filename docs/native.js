// Native plugins are provided by Capacitor only in the installed APK.
window.isPriemkaNative = () => !!window.Capacitor?.isNativePlatform?.();
window.shareNativeArchive = async (blob, filename) => {
  const fs = window.Capacitor.registerPlugin('Filesystem');
  const share = window.Capacitor.registerPlugin('Share');
  const path = `exports/${Date.now()}-${filename}`;
  const base64 = part => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(part);
  });
  await fs.mkdir({path:'exports',directory:'CACHE',recursive:true}).catch(()=>{});
  const chunkSize = 512 * 1024;
  for (let offset=0; offset<blob.size; offset+=chunkSize) {
    const options = {path, directory:'CACHE', data:await base64(blob.slice(offset,offset+chunkSize))};
    if (offset===0) await fs.writeFile(options); else await fs.appendFile(options);
  }
  const info = await fs.stat({path,directory:'CACHE'});
  if (info.size !== blob.size) throw Error('Архив записан не полностью. Попробуй выгрузку ещё раз.');
  const {uri} = await fs.getUri({path,directory:'CACHE'});
  await share.share({title:'Обход — Приёмка',files:[uri],dialogTitle:'Передать архив обхода'});
};
