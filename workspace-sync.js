import {currentWorkbenchAccount,requestWorkbenchWorkspace} from './workspace-account.js?v=20261127-login-design';

const isRevision = value => typeof value==='string' && /^[0-9a-f]{32}$/.test(value);
export const canEditWorkspace = () => currentWorkbenchAccount()?.role==='editor';

export async function readWorkspace(kind,revision='') {
  const release=await requestWorkbenchWorkspace(kind+(revision?'?revision='+revision:''));
  if (!isRevision(release.revision) || !Number.isFinite(Date.parse(release.updatedAt)) ||
      (!release.unchanged && typeof release.data!=='object')) throw Error('工作台版本不完整。');
  return release;
}

/** Serial writes with compare-and-swap, durable retries, and a local copy on conflict. */
export function createWorkspaceSync({kind,release,draftKey,onStatus=()=>{},onSaved=()=>{},fingerprint=JSON.stringify,
  storage=localStorage,request=requestWorkbenchWorkspace,canEdit=canEditWorkspace,settle=700}) {
  let revision=release.revision, accepted=fingerprint(release.data);
  let queued=null,ticket=null,conflict=null,paused=false,disposed=false,timer,sending=false;
  let wait=1500;
  try {
    const saved=JSON.parse(storage.getItem(draftKey)||'null');
    if (isRevision(saved?.revision) && (saved?.ticket || saved?.queued)) {
      ({revision,queued,ticket}=saved);
    }
  } catch {}
  const pending=()=>Boolean(ticket || queued);
  const pendingData=()=>queued || ticket?.data || null;
  const saveDraft=()=>{
    try {
      if (pending()) storage.setItem(draftKey,JSON.stringify({revision,queued,ticket}));
      else storage.removeItem(draftKey);
    } catch { /* Keep the draft, even if this browser has no space left. */ }
  };
  const schedule=(ms=settle)=>{
    clearTimeout(timer);
    if (!disposed&&!paused&&!conflict&&!sending&&pending()&&canEdit()) timer=setTimeout(send,ms);
  };
  const setBaseline=remote=>{revision=remote.revision;accepted=fingerprint(remote.data);};
  function change(data) {
    if (!canEdit() || fingerprint(data)===(pending()?fingerprint(pendingData()):accepted)) return;
    queued=structuredClone(data);
    saveDraft();
    if (!paused&&!conflict) onStatus('syncing','正在同步到线上');
    schedule();
  }
  async function send() {
    if (sending || disposed || paused || conflict || !canEdit()) return;
    if (!ticket && !queued) return;
    if (!ticket) {
      ticket={data:queued,baseRevision:revision,writeId:crypto.randomUUID().replaceAll('-','')};
      queued=null;
      saveDraft();
    }
    sending=true;
    const sent=ticket;
    try {
      const saved=await request(kind,{method:'PUT',body:sent,timeout:22000});
      if (!isRevision(saved.revision)||!Number.isFinite(Date.parse(saved.updatedAt))) throw Error('未收到保存确认。');
      const remote={...saved,data:sent.data};
      setBaseline(remote);
      ticket=null;
      if (queued && fingerprint(queued)===accepted) queued=null;
      saveDraft();
      wait=1500;
      if (!disposed) {
        onStatus(pending()?'syncing':'synced',pending()?'正在同步到线上':'已同步');
        onSaved(remote);
      }
    } catch(error) {
      if (disposed) return;
      if (error.status===409) {
        conflict=error.revision;
        onStatus('conflict','线上已有新版本，草稿已保留');
      } else if (error.status===401 || error.status===403 || error.status===413 || error.status===400) {
        paused=true;
        onStatus('attention',error.message);
      } else {
        wait=Math.min(wait*2,30000);
        onStatus('waiting','等待重新连接，草稿已保留');
      }
    } finally {
      sending=false;
      schedule(wait);
    }
  }
  return {
    pending,pendingData,change,revision:()=>revision,conflict:()=>Boolean(conflict),
    start(){onStatus(pending()?'waiting':'synced',pending()?'等待同步':'已同步');schedule(0);},
    retry(){paused=false;schedule(0);},
    acceptRemote(remote){
      if (pending() || sending) return false;
      setBaseline(remote);
      return true;
    },
    async publishDraft() {
      if (!conflict || sending || !canEdit()) return;
      sending=true;
      try {
        const remote=await readWorkspace(kind);
        if (remote.revision!==conflict) {
          conflict=remote.revision;
          onStatus('conflict','线上再次更新，请核对后重试');
          return;
        }
        queued=pendingData();
        ticket=null;
        setBaseline(remote);
        conflict=null;
        saveDraft();
        onStatus('syncing','正在同步到线上');
      } catch(error) {onStatus('conflict',error.message);}
      finally {sending=false;schedule(0);}
    },
    dispose(){disposed=true;clearTimeout(timer);}
  };
}

export function watchWorkspace(kind,currentRevision,apply) {
  let busy=false;
  async function refresh() {
    if (busy || document.hidden) return;
    busy=true;
    try {
      const next=await readWorkspace(kind,currentRevision());
      if (!next.unchanged && next.data) apply(next);
    } catch { /* Keep the last verified release visible. */ }
    finally {busy=false;}
  }
  window.addEventListener('focus',refresh);
  window.addEventListener('online',refresh);
  setInterval(refresh,12000);
}
