export function mountWorkspaceLogin(action,retryConnection) {
  const screen = document.createElement('main');
  screen.id = 'workbenchLogin';
  screen.className = 'workbench-login';
  screen.setAttribute('aria-labelledby','workbenchLoginTitle');
  screen.innerHTML = `
    <div class="workbench-login-intro">
      <div class="workbench-login-brand">
        <span class="workbench-login-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>LimiX 工作台</span>
      </div>
      <div class="workbench-login-identity">
        <h1 id="workbenchLoginTitle">基模-落地<br>牵引项目管理</h1>
        <p>查看项目进展、双周会与交付成果。</p>
      </div>
      <div class="workbench-login-diagram" aria-hidden="true">
        <i></i><i></i><i></i>
      </div>
    </div>
    <section class="workbench-login-access" aria-labelledby="workbenchLoginAccess">
      <div class="workbench-login-content">
        <h2 id="workbenchLoginAccess">登录工作台</h2>
        <p class="workbench-login-subtitle">使用已开通权限的公司飞书账号。</p>
        <button class="workbench-login-button" type="button">
          <span>使用飞书登录</span>
          <span class="workbench-login-arrow" aria-hidden="true">→</span>
        </button>
        <p class="workbench-login-status" role="status" aria-live="polite" hidden></p>
      </div>
    </section>
  `;
  const button = screen.querySelector('.workbench-login-button');
  const label = button.querySelector('span');
  const status = screen.querySelector('.workbench-login-status');
  button.addEventListener('click',()=>action());
  const opening = document.createElement('main');
  opening.id = 'workbenchOpening';
  opening.innerHTML = '<p role="status">正在打开工作台…</p><button type="button" hidden>重试连接</button>';
  const openingStatus = opening.querySelector('p');
  const retryButton = opening.querySelector('button');
  retryButton.addEventListener('click',retryConnection);
  document.body.prepend(screen,opening);
  return ({user,busy,error,opening:isOpening,retry})=>{
    document.body.classList.toggle('account-opening',isOpening&&document.body.classList.contains('account-gated'));
    button.disabled = Boolean(busy || user);
    label.textContent = busy || (user ? '正在打开工作台…' : '使用飞书登录');
    status.textContent = error;
    status.hidden = !error;
    openingStatus.textContent = retry ? '暂时连不上工作台，正在重试。' : '正在打开工作台…';
    retryButton.hidden = !retry;
  };
}
