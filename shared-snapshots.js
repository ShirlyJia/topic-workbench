import {createSnapshotStore} from './snapshot-store.js';
import {storageKey} from './deployment-config.js';
import {currentWorkbenchAccount} from './workspace-account.js?v=20261127-login-entry';
import {canEditWorkspace,createWorkspaceSync,readWorkspace,watchWorkspace} from './workspace-sync.js?v=20261127-login-entry';

const key=storageKey('topic-workbench-snapshots-v1');
export const localSnapshots=()=>createSnapshotStore({key});

export async function openSharedSnapshots({onStatus,onUpdate}={}) {
  if (!canEditWorkspace()) return null;
  const release=await readWorkspace('snapshots');
  const sync=createWorkspaceSync({kind:'snapshots',release,onStatus,draftKey:key+':shared:'+currentWorkbenchAccount().name});
  let value=sync.pendingData() || release.data;
  const store=createSnapshotStore({key,storage:{
    getItem:()=>JSON.stringify(value),
    setItem:(_key,raw)=>{
      if (!canEditWorkspace()) throw Error('快照由管理员维护。');
      value=JSON.parse(raw);
      sync.change(value);
      sync.retry();
    }
  }});
  watchWorkspace('snapshots',sync.revision,next=>{
    if (sync.acceptRemote(next)) {value=next.data;onUpdate?.();}
  });
  sync.start();
  return {store,sync};
}
