// Public editions have separate working copies. The original key stays accessible
// as "legacy", including edits made in an older tab that's still open.
const versionPattern = /^\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/;
const boardKey = 'topic-workbench-v2';

export function publicationStore(deployment, {edition, requested, disk}) {
  const prefix = deployment.public ? deployment.namespace + ':' : '';
  const originalKey = prefix + boardKey;
  const versioned = deployment.public && versionPattern.test(edition);
  const keyFor = id => id === 'legacy' ? originalKey : originalKey + ':' + id;
  let active = edition;
  if (versioned && requested && (requested === 'legacy' || versionPattern.test(requested))) {
    // A draft link opened on another device should open the published board.
    try { if (disk().getItem(keyFor(requested)) !== null) active = requested; } catch {}
  }
  return {
    edition: versioned ? edition : null,
    active: versioned ? active : null,
    key(key) { return versioned && key === boardKey ? keyFor(active) : prefix + key; },
    olderCopies() {
      if (!versioned) return [];
      const ids = [];
      try {
        const storage = disk();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key === originalKey) ids.push('legacy');
          else if (key?.startsWith(originalKey + ':')) {
            const id = key.slice(originalKey.length + 1);
            if (id !== edition && versionPattern.test(id)) ids.push(id);
          }
        }
      } catch {}
      return ids.sort((a,b) => a === 'legacy' ? 1 : b === 'legacy' ? -1 : b.localeCompare(a));
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
