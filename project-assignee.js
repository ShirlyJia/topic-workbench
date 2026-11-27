const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const assigneeNameLimit = 80;
const refPattern = /^[a-f0-9]{32}$/;
const recentLimit = 8;
const nameKey = name => name.trim().normalize('NFKC').toLocaleLowerCase();
const named = person => typeof person?.name === 'string' && person.name.trim() && person.name.length <= assigneeNameLimit;

export function isAssigneeAvatar(value) {
  return typeof value === 'string' && value.length <= 32800 &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function projectAssignees(project) {
  return Array.isArray(project?.assignees) ? project.assignees.filter(named) : named(project?.assignee) ? [project.assignee] : [];
}

export function assigneeMarkup(person) {
  if (!named(person)) return '';
  const initial = [...person.name.trim()][0].toLocaleUpperCase();
  return '<span class="project-assignee" title="'+esc(person.name)+'"><span class="assignee-avatar" aria-hidden="true">'+esc(initial)+
    (isAssigneeAvatar(person.avatar) ? '<img src="'+person.avatar+'" alt="" loading="lazy" width="24" height="24">' : '')+
    '</span><span class="assignee-name">'+esc(person.name)+'</span></span>';
}

export function assigneeListMarkup(people, limit=2) {
  if (!people.length) return '';
  const rest = people.length-limit;
  return '<span class="assignee-list" title="'+esc(people.map(person=>person.name).join('、'))+'">'+
    people.slice(0,limit).map(assigneeMarkup).join('')+
    (rest>0?'<span class="assignee-more" aria-label="另有 '+rest+' 人">+'+rest+'</span>':'')+'</span>';
}

export function assigneeFieldMarkup(people, editable) {
  if (!editable && !people.length) return '';
  const label = people.length ? '编辑负责人 · '+people.map(person=>person.name).join('、') : '选择负责人';
  const badges = assigneeListMarkup(people,editable?2:Infinity);
  const value = editable ? '<button type="button" data-assignee-trigger aria-haspopup="dialog" aria-label="'+esc(label)+'">'+
    (badges || '<span class="assignee-empty">＋ 选择</span>')+'</button>' : badges;
  return '<div class="detail-assignee-field"><span>负责人</span>'+value+'</div>';
}

async function directoryRequest(origin, connection, url, signal, timeout) {
  if (!connection) throw Error('连接这台 Mac 后可搜索飞书同事。');
  const timer = AbortSignal.timeout(timeout);
  let response;
  try {
    response = await fetch(new URL(url,origin), {cache:'no-store',headers:{Authorization:'Bearer '+connection},
      signal:signal?AbortSignal.any([signal,timer]):timer});
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Error('暂时连不上本机飞书通讯录。');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Error(result?.error || '暂时无法搜索飞书同事。');
  return result;
}

export function lookupFeishuAssignees(origin, connection, query, signal) {
  return directoryRequest(origin,connection,'/assignees?'+new URLSearchParams({query}),signal,8000);
}

export async function lookupFeishuAvatars(origin, connection, refs) {
  const query = new URLSearchParams(refs.map(ref=>['ref',ref]));
  const {avatars} = await directoryRequest(origin,connection,'/assignees/avatars?'+query,null,11500);
  return avatars || {};
}

function matchingPerson(rows, person) {
  const exact = person.ref && rows.find(row=>row.ref===person.ref);
  if (exact) return exact;
  const sameName = rows.filter(row=>nameKey(row.name)===nameKey(person.name) && !(row.ref && person.ref));
  const sameAvatar = person.avatar && sameName.find(row=>row.avatar===person.avatar);
  if (sameAvatar) return sameAvatar;
  return sameName.length===1 && (!person.avatar || !sameName[0].avatar) ? sameName[0] : undefined;
}

export function mountAssigneePicker({root, getProject, knownPeople, recentStorageKey, beforeOpen, lookup, lookupAvatars, assign, updateAvatars}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'assignee-dialog';
  dialog.setAttribute('aria-labelledby','assignee-dialog-title');
  dialog.innerHTML = '<header><h2 id="assignee-dialog-title">负责人</h2><span class="assignee-count"></span><button type="button" data-assignee-close aria-label="取消选人">×</button></header>'+
    '<div class="assignee-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12 12 4 4"/></svg><input type="search" aria-label="搜索飞书姓名" placeholder="搜索姓名，或手动添加" autocomplete="off" spellcheck="false" maxlength="'+assigneeNameLimit+'"></div>'+
    '<div class="assignee-picked" aria-label="已选负责人" hidden></div>'+
    '<div class="assignee-suggestions" hidden></div><div class="assignee-options" aria-label="可选负责人"></div>'+
    '<p class="assignee-status" role="status" hidden></p><button class="assignee-manual" data-assignee-manual type="button" hidden></button>'+
    '<footer><button type="button" data-assignee-close>取消</button><button class="assignee-done" data-assignee-done type="button">完成</button></footer>';
  document.body.append(dialog);
  const input = dialog.querySelector('input'), options = dialog.querySelector('.assignee-options');
  const picked = dialog.querySelector('.assignee-picked'), count = dialog.querySelector('.assignee-count');
  const suggestions = dialog.querySelector('.assignee-suggestions'), status = dialog.querySelector('[role="status"]');
  const manual = dialog.querySelector('[data-assignee-manual]');
  const searchCache = new Map(), avatarTasks = new Map(), loadedAvatars = new Map();
  let projectId = null, searchTimer, request, people = [], selected = [], initial = [], original = new Set(), composing = false;
  let common = null, recent = [];

  function recentRecord(person) {
    const record = {name:person.name.trim()};
    if (refPattern.test(person.ref || '')) record.ref = person.ref;
    if (typeof person.department==='string' && person.department.trim()) record.department = person.department.slice(0,96);
    const avatar = withAvatar(person).avatar;
    if (isAssigneeAvatar(avatar)) record.avatar = avatar;
    return record;
  }
  function refreshRecent() {
    if (!recentStorageKey) return;
    try {
      const raw = localStorage.getItem(recentStorageKey);
      if (raw === null) return;
      const rows = JSON.parse(raw);
      if (Array.isArray(rows)) recent = rows.slice(0,recentLimit).filter(named).map(recentRecord);
    } catch {}
  }
  function saveRecent(rows) {
    recent = rows;
    if (!recentStorageKey) return;
    try { localStorage.setItem(recentStorageKey,JSON.stringify(recent)); } catch {}
  }
  function rememberChoices(added) {
    refreshRecent();
    const next = [];
    for (const person of [...added].reverse().concat(recent)) {
      const record = recentRecord(person);
      if (!matchingPerson(next,record)) next.push(record);
      if (next.length===recentLimit) break;
    }
    saveRecent(next);
  }
  function commonPeople() {
    return common ??= knownPeople().filter(named);
  }

  function setStatus(text='') {
    status.textContent = text;
    status.hidden = !text;
  }
  function cancelSearch() {
    clearTimeout(searchTimer);
    request?.abort();
    request = null;
  }
  function withAvatar(person) {
    const avatar = loadedAvatars.get(person.ref) || person.avatar;
    return {...person,avatar};
  }
  function selectedIndex(person) {
    if (person.ref) {
      const refIndex = selected.findIndex(item=>item.ref===person.ref);
      if (refIndex>=0) return refIndex;
    }
    const name = nameKey(person.name);
    const sameName = selected.map((item,index)=>({item,index}))
      .filter(({item})=>nameKey(item.name)===name && !(person.ref && item.ref));
    const avatar = withAvatar(person).avatar;
    const match = avatar && sameName.find(({item})=>withAvatar(item).avatar===avatar);
    if (match) return match.index;
    const sameOptions = people.filter(row=>nameKey(row.name)===name);
    return sameName.length===1 && !sameName[0].item.avatar && sameOptions.length<=1 ? sameName[0].index : -1;
  }
  function refreshChecks() {
    options.querySelectorAll('[data-assignee-choice]').forEach(row=>{
      row.setAttribute('aria-pressed',String(selectedIndex(people[Number(row.dataset.assigneeChoice)])>=0));
    });
  }
  function renderPicked() {
    count.textContent = selected.length ? '已选 '+selected.length+' 人' : '';
    picked.hidden = !selected.length;
    picked.innerHTML = selected.map((person,index)=>'<button class="assignee-picked-chip" type="button" data-assignee-remove="'+index+
      '" aria-label="移除 '+esc(person.name)+'">'+assigneeMarkup(withAvatar(person))+'<span aria-hidden="true">×</span></button>').join('');
    refreshChecks();
    updateManual();
  }
  function updateManual() {
    const query = input.value.trim();
    const exists = query && [...people,...selected].some(person=>nameKey(person.name)===nameKey(query));
    manual.hidden = composing || !query || exists;
    manual.textContent = query ? '＋ 手动添加「'+query+'」' : '';
  }
  function showPeople(rows, label='') {
    people = rows;
    suggestions.textContent = label;
    suggestions.hidden = !label || !rows.length;
    options.innerHTML = rows.map((person,index)=>'<button class="assignee-option" data-assignee-choice="'+index+
      '" type="button" aria-pressed="false">'+assigneeMarkup(withAvatar(person))+
      (person.department ? '<span class="assignee-department" title="'+esc(person.department)+'">'+esc(person.department)+'</span>' : '')+
      '<span class="assignee-check" aria-hidden="true">✓</span></button>').join('');
    refreshChecks();
    updateManual();
  }
  function refreshImages() {
    function refresh(container,rows,key) {
      container.querySelectorAll('[data-assignee-'+key+']').forEach(el=>{
        const person = rows[Number(el.getAttribute('data-assignee-'+key))];
        if (!person || !loadedAvatars.has(person.ref) || el.querySelector('img')) return;
        el.querySelector('.project-assignee').outerHTML = assigneeMarkup(withAvatar(person));
      });
    }
    if (!dialog.open) return;
    refresh(options,people,'choice');
    refresh(picked,selected,'remove');
    refreshChecks();
  }
  function warmAvatars(rows) {
    const refs = [...new Set(rows.filter(row=>refPattern.test(row.ref || '') && !withAvatar(row).avatar && !avatarTasks.has(row.ref)).map(row=>row.ref))];
    if (!refs.length) return;
    const task = lookupAvatars(refs).then(avatars=>{
      for (const ref of refs) {
        if (isAssigneeAvatar(avatars[ref])) loadedAvatars.set(ref,avatars[ref]);
      }
      while (loadedAvatars.size>160) loadedAvatars.delete(loadedAvatars.keys().next().value);
      refreshImages();
    }).catch(()=>{}).finally(()=>refs.forEach(ref=>avatarTasks.delete(ref)));
    refs.forEach(ref=>avatarTasks.set(ref,task));
  }
  function showResult(result,local,recentMatches) {
    const rows = (Array.isArray(result.people)?result.people:[]).filter(named);
    const remaining = [...rows];
    const first = recentMatches.map(person=>{
      const match = matchingPerson(remaining,person);
      if (!match) return person;
      remaining.splice(remaining.indexOf(match),1);
      return {...person,...match,avatar:withAvatar(match).avatar || person.avatar};
    });
    const names = new Set(rows.map(person=>nameKey(person.name)));
    showPeople([...first,...remaining,...local.filter(person=>!names.has(nameKey(person.name)))]);
    setStatus(people.length ? result.notice : '没有找到匹配的飞书同事。');
    warmAvatars(rows);
  }
  function queueSearch() {
    cancelSearch();
    const query = input.value.trim(), key = nameKey(query);
    setStatus();
    if (!key) {
      showPeople(recent.length ? recent : commonPeople(),recent.length ? '最近选择' : '常用负责人');
      return;
    }
    const recentMatches = recent.filter(person=>nameKey(person.name).includes(key));
    const local = commonPeople().filter(person=>nameKey(person.name).includes(key) && !matchingPerson(recentMatches,person));
    showPeople([...recentMatches,...local]);
    if (composing) return;
    if ([...query].length > 50) { setStatus('可手动添加完整姓名。'); return; }
    const cached = searchCache.get(key);
    if (cached && cached.until>Date.now()) { showResult(cached.result,local,recentMatches); return; }
    searchTimer = setTimeout(async () => {
      const controller = request = new AbortController();
      setStatus('正在搜索飞书同事…');
      try {
        const result = await lookup(query,controller.signal);
        if (!dialog.open || request!==controller) return;
        searchCache.delete(key);
        searchCache.set(key,{until:Date.now()+120000,result});
        while (searchCache.size>30) searchCache.delete(searchCache.keys().next().value);
        showResult(result,local,recentMatches);
      } catch (error) {
        if (dialog.open && request===controller) setStatus(error.message);
      }
    }, 220);
  }
  function toggle(person) {
    if (!named(person) || composing) return;
    const index = selectedIndex(person);
    if (index>=0) selected.splice(index,1);
    else selected.push(withAvatar(person));
    renderPicked();
  }
  function storedPeople(rows) {
    return rows.map(person=>{
      const value = {name:person.name.trim()}, avatar = withAvatar(person).avatar;
      if (isAssigneeAvatar(avatar)) value.avatar = avatar;
      return value;
    });
  }
  function finishSelection() {
    if (!projectId || composing || getProject()?.id!==projectId) return;
    const id = projectId, rows = [...selected], values = storedPeople(rows);
    if (JSON.stringify(values)!==JSON.stringify(initial)) {
      if (assign(id,values)===false) return;
      const added = rows.filter(person=>!original.has(person));
      if (added.length) rememberChoices(added);
    }
    dialog.close();
    const pending = [...new Set(rows.map(person=>avatarTasks.get(person.ref)).filter(Boolean))];
    if (pending.length) Promise.all(pending).then(()=>{
      const filled = storedPeople(rows);
      if (JSON.stringify(filled)!==JSON.stringify(values)) updateAvatars(id,values,filled);
      const refs = new Set(rows.map(person=>person.ref).filter(Boolean));
      refreshRecent();
      const refreshed = recent.map(person=>refs.has(person.ref)?recentRecord(person):person);
      if (JSON.stringify(refreshed)!==JSON.stringify(recent)) saveRecent(refreshed);
    });
  }

  root.addEventListener('click',event=>{
    if (!event.target.closest('[data-assignee-trigger]') || dialog.open) return;
    const project = getProject();
    if (!project || beforeOpen()===false) return;
    projectId = project.id;
    selected = projectAssignees(project).slice();
    initial = storedPeople(selected);
    original = new Set(selected);
    refreshRecent();
    common = null;
    composing = false;
    input.value = '';
    queueSearch();
    renderPicked();
    dialog.showModal();
    input.focus();
  });
  input.addEventListener('compositionstart',()=>{composing=true;queueSearch();});
  input.addEventListener('compositionend',()=>{composing=false;queueSearch();});
  input.addEventListener('input',event=>{if (!event.isComposing) queueSearch();});
  dialog.addEventListener('keydown',event=>{
    event.stopPropagation();
    if (event.isComposing || composing) return;
    const row = event.target.closest('[data-assignee-choice]');
    if (event.key==='ArrowDown' || event.key==='ArrowUp') {
      const next = event.target===input ? options.firstElementChild :
        event.key==='ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling || (row && input);
      if (next) {event.preventDefault();next.focus();}
    }
    if (event.key==='Enter' && event.target===input) {
      const next = options.firstElementChild || (!manual.hidden && manual);
      if (next) {event.preventDefault();next.focus();}
    }
  });
  dialog.addEventListener('click',event=>{
    const action = event.target.closest('button');
    if (!action) return;
    if (action.hasAttribute('data-assignee-close')) dialog.close();
    else if (action.hasAttribute('data-assignee-done')) finishSelection();
    else if (action.hasAttribute('data-assignee-remove')) {
      selected.splice(Number(action.dataset.assigneeRemove),1);
      renderPicked();
      input.focus();
    } else if (action.hasAttribute('data-assignee-manual')) {
      toggle({name:input.value.trim()});
      input.value = '';
      queueSearch();
      input.focus();
    } else if (action.hasAttribute('data-assignee-choice')) toggle(people[Number(action.dataset.assigneeChoice)]);
  });
  dialog.addEventListener('close',()=>{
    if (dialog.open) return;
    cancelSearch();
    projectId = null;
    people = [];
    selected = [];
    original.clear();
    options.replaceChildren();
    root.querySelector('[data-assignee-trigger]')?.focus({preventScroll:true});
  });
}
