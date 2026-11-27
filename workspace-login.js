const mark = `<span class="workbench-login-mark" aria-hidden="true">
  <i></i><i></i><i></i>
</span>`;

export function mountWorkspaceLogin(action) {
  const screen = document.createElement('main');
  screen.id = 'workbenchLogin';
  screen.className = 'workbench-login';
  screen.setAttribute('aria-labelledby','workbenchLoginTitle');
  screen.innerHTML = `
    <section class="workbench-login-intro">
      <div class="workbench-login-brand">${mark}<span>LimiX 工作台</span></div>
      <div class="workbench-login-content">
        <h1 id="workbenchLoginTitle">基模-落地<br>牵引项目管理</h1>
        <p class="workbench-login-subtitle">用公司飞书账号登录，查看项目进展、会议记录和成果。</p>
        <button class="workbench-login-button" type="button">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5M4 12h10m-4-4 4 4-4 4"/>
          </svg>
          <span>使用飞书登录</span>
        </button>
        <p class="workbench-login-status" role="status" aria-live="polite" hidden></p>
      </div>
    </section>
    <div class="workbench-login-preview" aria-hidden="true">
      <div class="login-preview-grid">
        <div class="login-preview-frame">
          <div class="login-preview-bar">${mark}<span>自由画板</span></div>
          <div class="login-preview-board">
            <div class="login-preview-column">
              <span class="login-preview-label"><i></i>讨论与对齐</span>
              <div class="login-preview-card">
                <span>问题陈述</span>
                <b>明确业务场景</b>
                <i class="login-preview-line"></i><i class="login-preview-line short"></i>
              </div>
              <div class="login-preview-card login-preview-card-small">
                <span>会议记录</span>
                <b>补充讨论要点</b>
              </div>
            </div>
            <div class="login-preview-column login-preview-progress">
              <span class="login-preview-label"><i></i>跟进与交付</span>
              <div class="login-preview-card">
                <span>项目计划</span>
                <b>确定交付节点</b>
                <i class="login-preview-line"></i><i class="login-preview-line short"></i>
              </div>
              <div class="login-preview-card login-preview-card-small">
                <span>成果沉淀</span>
                <b>记录验证结论</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  const button = screen.querySelector('.workbench-login-button');
  const label = button.querySelector('span');
  const status = screen.querySelector('.workbench-login-status');
  button.addEventListener('click',()=>action());
  document.body.prepend(screen);
  return ({user,busy,error})=>{
    button.disabled = Boolean(busy || user);
    label.textContent = busy || (user ? '正在打开工作台…' : '使用飞书登录');
    status.textContent = error;
    status.hidden = !error;
  };
}
