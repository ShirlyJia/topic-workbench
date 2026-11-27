// Public editions have separate working copies. The original key stays accessible
// as "legacy", including edits made in an older tab that's still open.
const versionPattern = /^\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/;
const boardKey = 'topic-workbench-v2';

async function accessDrafts(mode, operation) {
  const database = await new Promise((resolve,reject) => {
    const request = indexedDB.open('topic-workbench-board-drafts',1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve,reject) => {
      const transaction = database.transaction('drafts',mode);
      const request = operation(transaction.objectStore('drafts'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error||Error('本机旧稿存储已中断'));
    });
  } finally {
    database.close();
  }
}

export function publicationStore(deployment, {edition, requested, disk}) {
  const prefix = deployment.public ? deployment.namespace + ':' : '';
  const originalKey = prefix + boardKey;
  const versioned = deployment.public && versionPattern.test(edition);
  const keyFor = id => id === 'legacy' ? originalKey : originalKey + ':' + id;
  const savedDrafts = new Set();
  let active = edition;
  if (versioned && requested && (requested === 'legacy' || versionPattern.test(requested))) {
    // A draft link opened on another device should open the published board.
    try { if (disk().getItem(keyFor(requested)) !== null) active = requested; } catch {}
  }
  return {
    edition: versioned ? edition : null,
    get active() { return versioned ? active : null; },
    key(key) { return versioned && key === boardKey ? keyFor(active) : prefix + key; },
    async loadDrafts() {
      if (!versioned) return;
      const keys = await accessDrafts('readonly',store=>store.getAllKeys());
      for (const key of keys) {
        if (typeof key==='string'&&key.startsWith(originalKey+':')&&versionPattern.test(key.slice(originalKey.length+1))) savedDrafts.add(key);
      }
      if (savedDrafts.has(keyFor(requested))) active=requested;
    },
    async readDraft() {
      const key = keyFor(active);
      if (!savedDrafts.has(key)) return null;
      return JSON.parse(await accessDrafts('readonly',store=>store.get(key)));
    },
    async archiveDraft(data) {
      if (!versioned) throw Error('无法在本机旧稿中保留画板');
      const id = new Date().toISOString().slice(0,10) + '-' + crypto.randomUUID().replaceAll('-','').slice(0,16);
      const key = keyFor(id);
      const contents = JSON.stringify(data);
      await accessDrafts('readwrite',store=>store.add(contents,key));
      savedDrafts.add(key);
    },
    olderCopies() {
      if (!versioned) return [];
      const ids = new Set([...savedDrafts].map(key=>key.slice(originalKey.length+1)));
      try {
        const storage = disk();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key === originalKey) ids.add('legacy');
          else if (key?.startsWith(originalKey + ':')) {
            const id = key.slice(originalKey.length + 1);
            if (id !== edition && versionPattern.test(id)) ids.add(id);
          }
        }
      } catch {}
      return [...ids].sort((a,b) => a === 'legacy' ? 1 : b === 'legacy' ? -1 : b.localeCompare(a));
    }
  };
}

export function showBoardCopies(container, publication, viewingArchive = publication.active!==publication.edition) {
  if (!publication.edition) return;
  function copyLink(id,text) {
    const url = new URL(location.href);
    url.searchParams.delete('view');
    if (id === publication.edition) url.searchParams.delete('draft');
    else url.searchParams.set('draft', id);
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = text;
    return link;
  }
  if (viewingArchive) container.append(copyLink(publication.edition,'返回线上画板'));
  const ids=publication.olderCopies().filter(id=>!viewingArchive||id!==publication.active);
  if (!ids.length) return;
  const details=document.createElement('details'),summary=document.createElement('summary');
  details.className='local-board-copies';
  summary.textContent='本机旧稿 · '+ids.length+' 份';
  details.append(summary);
  const dateCounts=new Map();
  for (const id of ids) {
    const date=id.slice(0,10),order=(dateCounts.get(date)||0)+1;
    dateCounts.set(date,order);
    const label=id==='legacy'?'早期本机画板':date+(order===1?'':' · 版本 '+order);
    details.append(copyLink(id,'打开 '+label));
  }
  container.append(details);
}
