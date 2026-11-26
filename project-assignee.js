const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const assigneeNameLimit = 80;

export function isAssigneeAvatar(value) {
  return typeof value === 'string' && value.length <= 32800 &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function assigneeMarkup(person) {
  if (typeof person?.name !== 'string' || !person.name.trim()) return '';
  const initial = [...person.name.trim()][0]?.toLocaleUpperCase() || '·';
  return `<span class="project-assignee" title="负责人 · ${esc(person.name)}"><span class="assignee-avatar" aria-hidden="true">${esc(initial)}${isAssigneeAvatar(person.avatar) ? `<img src="${person.avatar}" alt="" loading="lazy" width="24" height="24">` : ''}</span><span class="assignee-name">${esc(person.name)}</span></span>`;
}

export function assigneeFieldMarkup(person, editable) {
  if (!editable && !person?.name) return '';
  const badge = assigneeMarkup(person);
  const value = editable ? `<button type="button" data-assignee-trigger aria-haspopup="dialog" aria-label="${person?.name ? `更换负责人 · ${esc(person.name)}` : '选择负责人'}">${badge || '<span class="assignee-empty">＋ 选择</span>'}</button>` : badge;
  return `<div class="detail-assignee-field"><span>负责人</span>${value}</div>`;
}

export async function lookupFeishuAssignees(origin, connection, query, signal) {
  if (!connection) throw Error('连接这台 Mac 后可搜索飞书同事。');
  const url = new URL('/assignees', origin);
  url.searchParams.set('query', query);
  let response;
  try {
    response = await fetch(url, {cache:'no-store', headers:{Authorization:'Bearer '+connection},
      signal:AbortSignal.any([signal, AbortSignal.timeout(16500)])});
  } catch (error) {
    if (signal.aborted) throw error;
    throw Error('暂时连不上本机飞书通讯录。');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result?.people)) throw Error(result?.error || '暂时无法搜索飞书同事。');
  return result;
}

export function mountAssigneePicker({root, getProject, beforeOpen, lookup, assign}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'assignee-dialog';
  dialog.setAttribute('aria-labelledby','assignee-dialog-title');
  dialog.innerHTML = `<header><h2 id="assignee-dialog-title">负责人</h2><button type="button" data-assignee-close aria-label="关闭负责人选择">×</button></header>
    <div class="assignee-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12 12 4 4"/></svg><input type="search" aria-label="搜索飞书姓名" placeholder="搜索飞书姓名，或直接填写" autocomplete="off" spellcheck="false" maxlength="${assigneeNameLimit}"></div>
    <div class="assignee-options" aria-label="飞书搜索结果"></div><p class="assignee-status" role="status" hidden></p>
    <button class="assignee-manual" data-assignee-manual type="button" hidden></button>
    <footer><button class="assignee-clear" data-assignee-clear type="button" hidden>移除负责人</button></footer>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  const options = dialog.querySelector('.assignee-options');
  const status = dialog.querySelector('[role="status"]');
  const manual = dialog.querySelector('[data-assignee-manual]');
  const clear = dialog.querySelector('[data-assignee-clear]');
  let projectId = null, searchTimer, request, people = [], composing = false;

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }
  function cancelSearch() {
    clearTimeout(searchTimer);
    request?.abort();
    request = null;
  }
  function queueSearch() {
    cancelSearch();
    const query = input.value.trim();
    people = [];
    options.replaceChildren();
    manual.hidden = composing || !query;
    manual.textContent = query ? `手动填写「${query}」` : '';
    setStatus('');
    if (composing || !query) return;
    if ([...query].length > 50) { setStatus('飞书搜索最多支持 50 字。'); return; }
    searchTimer = setTimeout(async () => {
      const controller = request = new AbortController();
      setStatus('正在搜索飞书同事…');
      try {
        const result = await lookup(query, controller.signal);
        if (!dialog.open || request !== controller) return;
        people = result.people.filter(person => typeof person?.name === 'string' && person.name.trim() && person.name.length <= assigneeNameLimit);
        options.innerHTML = people.map((person, index) => `<button class="assignee-option" data-assignee-choice="${index}" type="button">${assigneeMarkup(person)}${person.department ? `<span class="assignee-department" title="${esc(person.department)}">${esc(person.department)}</span>` : ''}<small>飞书</small></button>`).join('');
        setStatus(people.length ? (result.notice || '') : '没有找到匹配的飞书同事。');
      } catch (error) {
        if (dialog.open && request === controller) setStatus(error.message);
      }
    }, 340);
  }
  function choose(person) {
    if (!projectId || getProject()?.id !== projectId || composing) return;
    const value = person ? {name:person.name.trim()} : null;
    if (value && (!value.name || value.name.length > assigneeNameLimit)) return;
    if (value && isAssigneeAvatar(person.avatar)) value.avatar = person.avatar;
    if (assign(projectId, value) === false) return;
    dialog.close();
    root.querySelector('[data-assignee-trigger]')?.focus({preventScroll:true});
  }

  root.addEventListener('click', event => {
    if (!event.target.closest('[data-assignee-trigger]')) return;
    const project = getProject();
    if (!project || beforeOpen() === false || dialog.open) return;
    projectId = project.id;
    composing = false;
    input.value = '';
    clear.hidden = !project.assignee?.name;
    queueSearch();
    dialog.showModal();
    input.focus();
  });
  input.addEventListener('compositionstart', () => { composing = true; queueSearch(); });
  input.addEventListener('compositionend', () => { composing = false; queueSearch(); });
  input.addEventListener('input', event => { if (!event.isComposing) queueSearch(); });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.target !== input || event.isComposing || composing) return;
    if (event.key === 'ArrowDown') {
      const next = options.querySelector('button') || (!manual.hidden && manual);
      if (next) { event.preventDefault(); next.focus(); }
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-assignee-close]')) { dialog.close(); return; }
    if (event.target.closest('[data-assignee-clear]')) { choose(null); return; }
    if (event.target.closest('[data-assignee-manual]')) { choose({name:input.value}); return; }
    const choice = event.target.closest('[data-assignee-choice]');
    const person = choice && people[Number(choice.dataset.assigneeChoice)];
    if (person) choose(person);
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    composing = false;
    cancelSearch();
    projectId = null;
    people = [];
    options.replaceChildren();
  });
}
