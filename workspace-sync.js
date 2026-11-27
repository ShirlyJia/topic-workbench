import {currentWorkbenchAccount,requestWorkbenchWorkspace} from './workspace-account.js?v=20261127-login-entry';
import {accessDrafts} from './board-publication.js?v=20261127-sync-draft';

const isRevision = value => typeof value==='string' && /^[0-9a-f]{32}$/.test(value);
export const canEditWorkspace = () => currentWorkbenchAccount()?.role==='editor';

export async function readWorkspace(kind,revision='') {
  const release=await requestWorkbenchWorkspace(kind+(revision?'?revision='+revision:''));
  if (!isRevision(release.revision) || !Number.isFinite(Date.parse(release.updatedAt)) ||
      (!release.unchanged && typeof release.data!=='object')) throw Error('工作台版本不完整。');
  return release;
}

/** Serial writes with compare-and-swap, durable retries, and a local copy on conflict. */
export async function createWorkspaceSync({kind,release,draftKey,onStatus=()=>{},onSaved=()=>{},fingerprint=JSON.stringify,
  storage=localStorage,request=requestWorkbenchWorkspace,canEdit=canEditWorkspace,settle=700}) {
  let revision=release.revision, accepted=fingerprint(release.data);
  let queued=null,ticket=null,conflict=null,paused=false,disposed=false,timer,sending=false;
  let wait=1500;
  let legacyRaw,saved,useIndexedDB=true;
  const journalKey='workspace-sync:'+draftKey;
  try {
    legacyRaw=storage.getItem(draftKey);
    saved=JSON.parse(legacyRaw||'null');
  } catch {}
  try {
    saved=await accessDrafts('readonly',store=>store.get(journalKey))??saved;
  } catch { useIndexedDB=false; }
  if (isRevision(saved?.revision) && (saved?.ticket || saved?.queued)) {
    ({revision,queued,ticket}=saved);
  }

  const pending=()=>Boolean(ticket || queued);
  const pendingData=()=>queued || ticket?.data || null;
  let lastStoredStamp=saved?.stamp, draftState='saved', writes=Promise.resolve();
  let syncStatus=['waiting','等待同步'];
  function report() {
    if (disposed) return;
    if (pending()&&draftState==='saving') onStatus('saving','正在保存到本机');
    else if (pending()&&draftState==='failed') onStatus('draft-error','本机保存失败 · 点击重试');
    else onStatus(...syncStatus);
  }
  function status(...next) { syncStatus=next;report(); }

  function saveDraft(newContent=false) {
    const draft=pending()?{revision,queued,ticket,stamp:crypto.randomUUID()}:null;
    if (newContent) {
      draftState='saving';
      report();
    }
    const write=writes.then(async()=>{
      if (!useIndexedDB) {
        const raw=draft?JSON.stringify(draft):null;
        if (draft) storage.setItem(draftKey,raw);
        else if (storage.getItem(draftKey)===legacyRaw) storage.removeItem(draftKey);
        legacyRaw=raw;
        return;
      }
      if (draft) await accessDrafts('readwrite',store=>store.put(draft,journalKey));
      else await accessDrafts('readwrite',store=>{
        // Acknowledging this write must not delete a newer draft from another tab.
        const current=store.get(journalKey);
        current.onsuccess=()=>{if (current.result?.stamp===lastStoredStamp) store.delete(journalKey);};
        return current;
      });
      lastStoredStamp=draft?.stamp;
      if (legacyRaw!=null) {
        try {
          if (storage.getItem(draftKey)===legacyRaw) storage.removeItem(draftKey);
          legacyRaw=null;
        } catch {}
      }
    });
    const settled=write.then(()=>finish('saved'),()=>finish('failed'));
    function finish(state) {
      if (writes!==settled) return;
      draftState=state;
      report();
    }
    writes=settled;
    return settled;
  }
  const schedule=(ms=settle)=>{
    clearTimeout(timer);
    if (!disposed&&!paused&&!conflict&&!sending&&pending()&&canEdit()) timer=setTimeout(send,ms);
  };
  const setBaseline=remote=>{revision=remote.revision;accepted=fingerprint(remote.data);};
  const reconnect=()=>schedule(0);
  function change(data) {
    if (!canEdit() || fingerprint(data)===(pending()?fingerprint(pendingData()):accepted)) return;
    queued=structuredClone(data);
    if (paused===400||paused===413) paused=false;
    if (!paused&&!conflict) syncStatus=['syncing','正在同步到线上'];
    saveDraft(true);
    schedule();
  }
  async function send() {
    if (sending || disposed || paused || conflict || !canEdit()) return;
    if (!ticket && !queued) return;
    sending=true;
    try {
      if (!ticket) {
        ticket={data:queued,baseRevision:revision,writeId:crypto.randomUUID().replaceAll('-','')};
        queued=null;
        await saveDraft();
      }
      if (disposed || !canEdit()) return;
      const sent=ticket;
      const saved=await request(kind,{method:'PUT',body:sent,timeout:22000});
      if (!isRevision(saved.revision)||!Number.isFinite(Date.parse(saved.updatedAt))) throw Error('未收到保存确认。');
      const remote={...saved,data:sent.data};
      setBaseline(remote);
      ticket=null;
      if (queued && fingerprint(queued)===accepted) queued=null;
      await saveDraft();
      wait=1500;
      if (!disposed) {
        onSaved(remote);
        status(pending()?'syncing':'synced',pending()?'正在同步到线上':'已同步');
      }
    } catch(error) {
      if (disposed) return;
      if (error.status===409) {
        conflict=error.revision;
        status('conflict','线上已有新版本，草稿已保留');
      } else if (error.status===401 || error.status===403 || error.status===413 || error.status===400) {
        paused=error.status;
        // These validation errors reject the write before applying it.
        // Retrying can submit the corrected draft with a fresh write ID.
        if (error.status===400 || error.status===413) {
          const updateQueued=Boolean(queued);
          queued??=ticket.data;
          ticket=null;
          saveDraft();
          if (updateQueued) paused=false;
        }
        status(paused?'attention':'syncing',paused?error.message:'正在同步到线上',error.status);
      } else {
        wait=Math.min(wait*2,30000);
        status('waiting','等待重新连接，草稿已保留');
      }
    } finally {
      sending=false;
      schedule(wait);
    }
  }
  return {
    pending,pendingData,change,revision:()=>revision,conflict:()=>Boolean(conflict),
    start(){
      window.addEventListener('online',reconnect);
      status(pending()?'waiting':'synced',pending()?'等待同步':'已同步');
      schedule(0);
    },
    retry(){
      paused=false;
      if (pending()&&draftState==='failed') saveDraft(true);
      schedule(0);
    },
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
          status('conflict','线上再次更新，请核对后重试');
          return;
        }
        queued=pendingData();
        ticket=null;
        setBaseline(remote);
        conflict=null;
        syncStatus=['syncing','正在同步到线上'];
        await saveDraft(true);
      } catch(error) {status('conflict',error.message);}
      finally {sending=false;schedule(0);}
    },
    dispose(){disposed=true;clearTimeout(timer);window.removeEventListener('online',reconnect);}
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
  document.addEventListener('visibilitychange',refresh);
  setInterval(refresh,12000);
}
