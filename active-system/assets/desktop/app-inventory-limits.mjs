// Installed trusted code, not user files or a resident-memory allowance.
export const APP_INVENTORY_LIMITS=Object.freeze({files:4096,assetBytes:256*1024*1024,totalBytes:1024*1024*1024});
export function assertAppInventory(sizes){
  const limits=APP_INVENTORY_LIMITS;
  if(!Array.isArray(sizes)||sizes.length>limits.files)throw Error('App bundle exceeds file/size limits');
  let total=0;
  for(const size of sizes){
    if(!Number.isSafeInteger(size)||size<0||size>limits.assetBytes)throw Error('App bundle exceeds file/size limits');
    total+=size;
    if(total>limits.totalBytes)throw Error('App bundle exceeds file/size limits');
  }
  return total;
}
