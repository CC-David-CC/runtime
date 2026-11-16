import {createDocumentOperationCoordinator, createDocumentOperations} from './document-operations.mjs';

// Share admission across app windows in one exact session, never across users.
const sessionCoordinators = new WeakMap();
function documentCoordinator(session, owner) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function') || !owner) {
    return createDocumentOperationCoordinator(); // Isolated non-account/test host.
  }
  let owners = sessionCoordinators.get(session);
  if (!owners) sessionCoordinators.set(session, owners = new Map());
  if (!owners.has(owner)) owners.set(owner, createDocumentOperationCoordinator());
  return owners.get(owner);
}

/** One mounted view owns one cleanup and file-operation scope. */
export function mountApp(module,host){
  const controller=new AbortController(),callbacks=new Set();let view,disposed=false,documentOperations;
  const onDispose=callback=>{
    if(typeof callback!=='function')throw TypeError('Cleanup callback required');
    if(disposed)throw Error('App view already disposed');
    callbacks.add(callback);return ()=>callbacks.delete(callback);
  };
  function dispose(reason='View removed'){
    if(disposed)return [];disposed=true;
    const errors=[];const attempt=action=>{try{action();}catch(error){errors.push(error);}};
    controller.abort(reason);
    if(typeof view?.dispose==='function')attempt(()=>view.dispose());
    for(const callback of [...callbacks].reverse())attempt(callback);
    callbacks.clear();
    if(errors.length)console.error('App cleanup failed',new AggregateError(errors));
    return errors;
  }
  try{
    const session = host.session?.(), owner = host.storage?.signedInSubject?.();
    documentOperations = createDocumentOperations({
      signal: controller.signal,
      coordinator: documentCoordinator(session, owner),
      valid: () => !disposed && host.session?.() === session && host.storage?.signedInSubject?.() === owner
        && (!host.desktop?.windows || host.desktop.windows.includes(host.w))
    });
    const tools=host.tools&&{...host.tools};
    if(tools?.createFFmpeg){const create=tools.createFFmpeg;tools.createFFmpeg=async (...args)=>{const tool=await create(...args);if(disposed){tool.dispose();throw Error('App view closed.');}onDispose(()=>tool.dispose());return tool;};}
    if(tools?.createWaveSurfer){const create=tools.createWaveSurfer;tools.createWaveSurfer=async (...args)=>{const wave=await create(...args);if(disposed){wave.destroy();throw Error('App view closed.');}onDispose(()=>wave.destroy());return wave;};}
    if(tools?.loadTone){const load=tools.loadTone;tools.loadTone=async (...args)=>{if(disposed)throw Error('App view closed.');const tone=await load(...args);if(disposed)throw Error('App view closed.');return tone;};}
    view=module.mount({...host,tools,version:2,signal:controller.signal,onDispose,documentOperations});
    if(!view||!(view.element instanceof HTMLElement)||!view.element.classList.contains('window-content')||typeof view.dispose!=='function'||typeof view.then==='function')throw Error('App API 2 requires { element, dispose() }');
    // Optional additive API: legacy apps continue to mount unchanged. The
    // session host validates lifecycle before relying on it.
    return {element:view.element,signal:controller.signal,dispose,lifecycle:view.lifecycle,documentOperations,
      ready:view.ready,inspect:view.inspect,execute:view.execute,requestClose:view.requestClose};
  }catch(error){dispose('Mount failed');throw error;}
}
