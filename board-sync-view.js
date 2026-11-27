const states={
  loading:{title:'正在载入',description:'正在读取线上画板。'},
  saved:{title:'已保存到本机',description:'当前改动已保存在这个浏览器中。'},
  saving:{title:'正在保存',description:'停下编辑后会自动保存。'},
  synced:{label:'已同步',title:'已同步到线上',description:'已开通的成员可以看到当前画板版本。'},
  syncing:{title:'正在同步',description:'改动已保存到本机，正在更新共享画板。'},
  waiting:{title:'等待同步',description:'改动已保存在本机。暂时连不上同步服务，系统会自动重试。',retry:'同步',backup:true},
  conflict:{title:'线上有新版本',description:'本机改动已保留。先查看线上版，再决定是否发布本机草稿。',online:true,publish:true},
  'local-draft':{label:'本机有改动',title:'本机有未同步改动',description:'这份草稿与线上版不同。用线上版继续编辑时，草稿会保留在本机旧稿。',online:true,publish:true,resume:true},
  attention:{title:'暂未同步',description:'改动已保存在本机。请先处理下面的问题。',backup:true},
  failed:{title:'本机保存失败',description:'改动还在当前页面，可以重试保存或下载备份。',retry:'保存',backup:true},
  incomplete:{title:'有必填项未完成',description:'补齐当前编辑里的必填项后，会自动保存。'},
  reader:{label:'线上版',title:'当前查看线上版',description:'当前账号可以查看项目和留言。'},
  draft:{label:'本机旧稿',title:'当前查看本机旧稿',description:'这份画板来自当前浏览器。可以下载备份或返回线上版。',online:true,backup:true},
  recovery:{title:'本机记录无法读取',description:'原记录已保留。可以用画板里的「导出原始记录」下载备份。'},
  unavailable:{title:'画板暂未载入',description:'暂时无法读取线上画板。'},
};

const blocked={
  400:{reason:'画板内容有无效字段，请检查刚修改的内容。',retry:'同步'},
  401:{reason:'登录已过期，请重新登录后再同步。',account:true},
  403:{reason:'当前飞书账号没有画板编辑权限。',account:true},
  413:{reason:'画板内容超出大小限制。请缩小或移除最近添加的大图片，再重试。',retry:'同步'},
};

export function mountBoardSyncStatus(button) {
  const panel=document.createElement('div');
  panel.id='boardSyncStatus';
  panel.className='board-sync-popover';
  panel.setAttribute('popover','auto');
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-labelledby','boardSyncTitle');
  panel.innerHTML=`<h2 id="boardSyncTitle">正在载入</h2>
    <p data-sync-description>正在读取线上画板。</p>
    <p class="sync-blocked-reason" data-sync-reason hidden></p>
    <div data-sync-actions class="sync-status-actions" hidden>
      <button type="button" data-sync-resume hidden>用线上版继续</button>
      <a data-sync-online target="_blank" rel="noopener" hidden>查看线上版 ↗</a>
      <button type="button" data-sync-retry hidden>重试同步</button>
      <button type="button" data-sync-backup hidden>下载草稿</button>
      <button type="button" data-sync-account hidden>查看账号</button>
      <button type="button" data-sync-publish hidden>发布本机草稿</button>
    </div>`;
  button.after(panel);
  button.setAttribute('popovertarget',panel.id);
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-controls',panel.id);
  button.setAttribute('aria-expanded','false');
  button.title='查看画板同步状态';
  const label=button.querySelector('#saveStatusLabel')||button;
  button.insertAdjacentHTML('beforeend','<span class="sync-chevron" aria-hidden="true"></span>');
  const title=panel.querySelector('h2'),description=panel.querySelector('[data-sync-description]');
  const reason=panel.querySelector('[data-sync-reason]'),actions=panel.querySelector('[data-sync-actions]');
  const retry=panel.querySelector('[data-sync-retry]'),backup=panel.querySelector('[data-sync-backup]');
  const account=panel.querySelector('[data-sync-account]'),online=panel.querySelector('[data-sync-online]');
  const publish=panel.querySelector('[data-sync-publish]');
  const resume=panel.querySelector('[data-sync-resume]');
  const url=new URL(location.href);
  url.searchParams.delete('draft');
  url.searchParams.set('view','online');
  online.href=url.href;

  function position() {
    const box=button.getBoundingClientRect(),width=Math.min(326,innerWidth-24);
    panel.style.left=Math.max(12,Math.min(box.right-width,innerWidth-width-12))+'px';
    panel.style.right='auto';
    panel.style.top=Math.round(box.bottom+8)+'px';
  }
  panel.addEventListener('beforetoggle',event=>{if(event.newState==='open')position();});
  panel.addEventListener('toggle',()=>button.setAttribute('aria-expanded',String(panel.matches(':popover-open'))));
  window.addEventListener('resize',()=>{if(panel.matches(':popover-open'))position();},{passive:true});

  function render(local,sync,hasBoard) {
    const phase=sync?.phase||local;
    const info=states[phase]||states.loading;
    const issue=phase==='attention'?(blocked[sync?.status]||{reason:sync?.message||'同步服务暂不可用。',retry:'同步'}):null;
    const waitingToSend=phase==='waiting'&&sync?.message==='等待同步';
    const conflictNote=phase==='conflict'&&sync?.message!=='线上已有新版本，草稿已保留'?sync?.message:'';
    const retryKind=issue?.retry||info.retry;

    button.dataset.savePhase=phase;
    const badge=info.label||info.title;
    if (label.textContent!==badge) label.textContent=badge;
    title.textContent=info.title;
    description.textContent=waitingToSend?'改动已保存到本机，等待同步到线上。':info.description;
    reason.textContent=issue?.reason||conflictNote||'';
    reason.hidden=!reason.textContent;
    retry.hidden=!retryKind;
    retry.dataset.syncRetry=retryKind||'';
    retry.textContent=retryKind?'重试'+retryKind:'';
    backup.hidden=!(info.backup&&hasBoard);
    account.hidden=!issue?.account;
    online.hidden=!info.online;
    publish.hidden=!info.publish;
    resume.hidden=!info.resume;
    actions.hidden=[retry,backup,account,online,publish,resume].every(element=>element.hidden);
  }
  return {panel,render};
}
