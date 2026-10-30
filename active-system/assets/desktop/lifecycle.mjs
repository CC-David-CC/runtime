import {strictJson} from '../../network/strict-json.mjs';

/** Preserve an open desktop while services recover. This does not save a VM. */
export function startLifecycle({config,roots,getGuestLink=()=>true,hasRunningGuest=()=>true,recoverSession=async()=>{},pollMs=3000,initiallyDisconnected=false}){
  const policy=config.desktopLifecycle,base=config.identity.apiBase.slice(0,-7);
  if(policy?.version!=='codi-desktop-lifecycle/1'||policy.statusPath!==base+'/api/v1/desktop-status')throw Error('Invalid desktop status path');
  const layer=document.createElement('section');layer.id='desktop-recovery';layer.hidden=true;layer.setAttribute('role','alertdialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-labelledby','desktop-recovery-title');
  const title=document.createElement('h2');title.id='desktop-recovery-title';
  const message=document.createElement('p'),clock=document.createElement('p'),spinner=document.createElement('span');spinner.className='recovery-spinner';spinner.setAttribute('aria-hidden','true');
  const action=document.createElement('button');action.type='button';
  const retry=document.createElement('button');retry.type='button';retry.textContent='Try again now';
  const card=document.createElement('div');card.className='recovery-card';card.tabIndex=-1;card.append(spinner,title,message,clock,action,retry);layer.append(card);document.body.append(layer);
  const banner=document.createElement('button');banner.type='button';banner.id='maintenance-banner';banner.hidden=true;document.body.append(banner);
  let stopped=false,controller,timer,tick,epoch=null,notice=null,offset=0,failures=0,blocked=false,disconnected=initiallyDisconnected,acknowledged=null,restoring=false,previousFocus=null,healthy=false;
  const priorInert=new Map();
  function block(value){
    if(blocked===value)return;blocked=value;document.documentElement.dataset.desktopBlocked=String(value);
    if(value){previousFocus=document.activeElement;for(const root of roots()){if(root){priorInert.set(root,root.inert);root.inert=true;}}document.dispatchEvent(new Event('codi-desktop-blocked'));(retry.disabled?card:retry).focus();}
    else{for(const [root,was] of priorInert)root.inert=was;priorInert.clear();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
  }
  function render(){
    const now=Date.now()/1000+offset,planned=notice&&notice.phase!=='cancelled'&&notice.expiresAt>now;
    const seconds=planned?Math.max(0,Math.ceil(notice.deadline-now)):0,due=planned&&(notice.phase==='active'||!seconds);
    if(due||disconnected||restoring){
      action.hidden=true;retry.hidden=false;retry.disabled=restoring;layer.hidden=false;block(true);banner.hidden=true;spinner.hidden=false;
      title.textContent=due?'Server maintenance':'Connection interrupted';
      message.textContent='Keep this tab open while we reconnect. Unsaved work is still in this tab’s memory; it has not been saved to disk.';
      if(!hasRunningGuest())message.textContent='Waiting for the server. This page has not restored a previous Linux session. After a reload or browser crash, reopen your last saved files when the server returns. Unsaved work from an earlier tab was not automatically saved.';
      if(restoring){title.textContent='Reconnecting your session';message.textContent='The server is back. Checking your session while keeping Linux and local drafts in this tab.';}
      clock.textContent=due?'Maintenance is in progress. We’ll keep trying.':'Trying again automatically…';
    }else{
      block(false);spinner.hidden=true;retry.hidden=true;banner.hidden=!planned;
      if(planned){
        banner.textContent='Maintenance in '+seconds+'s · Save your work';
        title.textContent='Server restarting for maintenance';
        message.textContent=notice.message+' Save important work to My server files or download it before the countdown ends. Saving inside the temporary Linux guest alone does not survive a reload.';
        clock.textContent='Starts in '+seconds+' seconds. Nothing is automatically saved by this warning.';
        action.textContent='Return to save my work';action.hidden=false;layer.hidden=acknowledged===notice.id;
      }else layer.hidden=true;
    }
  }
  action.addEventListener('click',()=>{acknowledged=notice?.id;layer.hidden=true;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});});
  retry.addEventListener('click',()=>{clearTimeout(timer);if(!controller||controller.signal.aborted)poll();});
  banner.addEventListener('click',()=>{acknowledged=null;render();action.focus();});
  function guard(event){if(blocked&&!layer.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}}
  const guarded=['pointerdown','click','keydown','beforeinput','paste','drop'];for(const name of guarded)document.addEventListener(name,guard,true);
  const unload=event=>{if(blocked||notice&&notice.phase!=='cancelled'){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);
  async function poll(){
    if(stopped)return;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),4000);
    try{
      const response=await fetch(policy.statusPath,{cache:'no-store',credentials:'same-origin',mode:'same-origin',redirect:'error',signal:controller.signal});
      if(!response.ok)throw Error('Status unavailable');
      const reader=response.body.getReader(),chunks=[];let length=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192)throw Error('Status too large');chunks.push(value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}
      const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
      const state=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:8192});
      if(state.version!=='codi-desktop-status/1'||typeof state.epoch!=='string'||!/^[a-f0-9-]{36}$/.test(state.epoch)||!Number.isSafeInteger(state.serverTime))throw Error('Invalid status');
      const n=state.maintenance;
      if(n!==null&&(!n||n.version!=='codi-maintenance-notice/1'||typeof n.id!=='string'||!/^[a-f0-9]{32}$/.test(n.id)||!['scheduled','active','cancelled'].includes(n.phase)||!Number.isSafeInteger(n.deadline)||!Number.isSafeInteger(n.expiresAt)||n.expiresAt<n.deadline||n.expiresAt>n.deadline+86400||typeof n.message!=='string'||n.message.length>500))throw Error('Invalid maintenance notice');
      const changed=epoch!==null&&epoch!==state.epoch;healthy=true;failures=0;offset=state.serverTime-Date.now()/1000;notice=n;
      if(changed){restoring=true;render();await recoverSession();}
      epoch=state.epoch;restoring=false;disconnected=!getGuestLink();render();
    }catch(error){if(!stopped){healthy=false;if(++failures>=2){disconnected=true;render();}}}
    finally{clearTimeout(timeout);controller=null;if(!stopped)timer=setTimeout(poll,pollMs);}
  }
  const offline=()=>{disconnected=true;render();};window.addEventListener('offline',offline);
  const online=()=>{clearTimeout(timer);if(!controller||controller.signal.aborted)poll();};window.addEventListener('online',online);
  tick=setInterval(()=>{if(healthy&&!getGuestLink())disconnected=true;render();},250);render();poll();
  return {get state(){return {blocked,disconnected,epoch,notice:notice?{id:notice.id,phase:notice.phase,deadline:notice.deadline}:null};},
    stop(){stopped=true;controller?.abort();clearTimeout(timer);clearInterval(tick);block(false);for(const name of guarded)document.removeEventListener(name,guard,true);window.removeEventListener('offline',offline);window.removeEventListener('online',online);window.removeEventListener('beforeunload',unload);layer.remove();banner.remove();}};
}
