/** One mounted view owns one cleanup scope. Shared services remain host-owned. */
export function mountApp(module,host){
  const controller=new AbortController(),callbacks=new Set();let view,disposed=false;
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
    const tools=host.tools&&{...host.tools};
    if(tools?.createFFmpeg){const create=tools.createFFmpeg;tools.createFFmpeg=async (...args)=>{const tool=await create(...args);if(disposed){tool.dispose();throw Error('App view closed.');}onDispose(()=>tool.dispose());return tool;};}
    view=module.mount({...host,tools,version:2,signal:controller.signal,onDispose});
    if(!view||!(view.element instanceof HTMLElement)||!view.element.classList.contains('window-content')||typeof view.dispose!=='function'||typeof view.then==='function')throw Error('App API 2 requires { element, dispose() }');
    return {element:view.element,signal:controller.signal,dispose};
  }catch(error){dispose('Mount failed');throw error;}
}
