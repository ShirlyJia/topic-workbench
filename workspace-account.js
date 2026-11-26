const service = 'https://topic-collaboration-shirly.shirlyjia826.chatgpt.site';
const sessionKey = 'topic-workbench-account-v1';
const verifierKey = sessionKey+':verifier';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
let verifiedProfile = null, profileToken = '';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hash = async text => encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))));
const userIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="3"/><path d="M4 16a6 6 0 0 1 12 0"/></svg>';
const cancelMessages = {
  cancelled:'飞书验证未完成，可以重新登录。',
  tenant:'请切换到公司的飞书账号。',
  permission:'当前飞书账号尚未在应用可用范围内。',
  provider:'飞书验证暂时失败，请重试。'
};

function credential() {
  try {
    const saved = JSON.parse(localStorage.getItem(sessionKey) || 'null');
    return tokenPattern.test(saved?.token || '') && saved.expiresAt > Date.now() ? saved : null;
  } catch {
    return null;
  }
}

async function serviceRequest(path,{method='GET',token,body,unavailable='账号验证暂不可用，请稍后重试。'}={}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer '+token;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(service+'/api/'+path,{method,headers,body:body && JSON.stringify(body),
      cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
  } catch {
    throw Error(unavailable);
  }
  const result = await response.json().catch(()=>null);
  if (!response.ok || !result || typeof result!=='object') throw Error(result?.error || unavailable);
  return result;
}

const accountRequest = (path,options) => serviceRequest('account/'+path,options);

export function requestWorkbenchComments(path,options) {
  return serviceRequest(path,{...options,token:credential()?.token,unavailable:'留言暂不可用，请稍后重试。'});
}

export function currentWorkbenchAccount() {
  return credential()?.token===profileToken ? verifiedProfile : null;
}

export function openWorkbenchAccount() {
  const menu = document.getElementById('workspaceAccountMenu');
  if (menu?.matches(':popover-open')) menu.querySelector('.account-action')?.focus();
  else document.querySelector('#workspaceAccount .account-trigger')?.click();
}

export function feishuAvatarSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password &&
        /(?:^|\.)(?:feishucdn\.com|larksuitecdn\.com|larkofficeimg\.com|byteimg\.com|bytednsdoc\.com|feishu\.cn)$/i.test(url.hostname)) return url.href;
  } catch {}
  return '';
}

function avatar(user) {
  const picture = document.createElement('span');
  picture.className = 'account-avatar';
  picture.setAttribute('aria-hidden','true');
  if (!user) { picture.innerHTML = userIcon; return picture; }
  picture.textContent = [...user.name][0]?.toLocaleUpperCase() || '·';
  const source = feishuAvatarSource(user.avatar);
  if (source) {
    const image = document.createElement('img');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error',()=>image.remove(),{once:true});
    image.src = source;
    picture.append(image);
  }
  return picture;
}

function mountAccount(root) {
  root.innerHTML = '<button class="account-trigger" type="button" aria-haspopup="dialog" aria-controls="workspaceAccountMenu" aria-expanded="false"></button>'+
    '<div class="account-menu" id="workspaceAccountMenu" popover="auto" role="dialog" aria-label="个人账号">'+
    '<div class="account-summary"></div><p class="account-message" role="status" hidden></p><button class="account-action" type="button"></button></div>';
  const trigger = root.querySelector('.account-trigger'), panel = root.querySelector('.account-menu');
  const summary = panel.querySelector('.account-summary'), message = panel.querySelector('.account-message'), action = panel.querySelector('.account-action');
  let user = null, busy = '', error = '', verifiedToken = '', verifiedAt = 0, generation = 0, verifying;

  function render() {
    const label = document.createElement('span');
    label.className = 'account-trigger-label';
    label.textContent = user?.name || '飞书登录';
    trigger.replaceChildren(avatar(user),label);
    trigger.setAttribute('aria-label',user ? '个人账号 · '+user.name : '飞书登录');
    trigger.title = trigger.getAttribute('aria-label');
    if (user) {
      const identity = document.createElement('div');
      identity.className = 'account-identity';
      const name = document.createElement('strong'), role = document.createElement('span');
      name.textContent = user.name;
      role.textContent = '飞书成员';
      identity.append(name,role);
      summary.replaceChildren(avatar(user),identity);
    } else summary.textContent = '登录画板账号';
    message.textContent = error;
    message.hidden = !error;
    action.textContent = busy || (user ? '退出登录' : '使用公司飞书登录');
    action.disabled = Boolean(busy);
    action.classList.toggle('sign-in',!user);
    const token = user ? verifiedToken : '';
    if (profileToken!==token || verifiedProfile?.name!==user?.name || verifiedProfile?.avatar!==user?.avatar) {
      profileToken = token;
      verifiedProfile = user;
      window.dispatchEvent(new Event('workbench-account-changed'));
    }
  }

  function position() {
    const bounds = trigger.getBoundingClientRect();
    panel.style.top = Math.round(bounds.bottom+8)+'px';
    panel.style.right = Math.max(10,Math.round(innerWidth-bounds.right))+'px';
  }
  function openMenu() {
    position();
    if (!panel.matches(':popover-open')) panel.showPopover();
  }
  panel.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(panel.matches(':popover-open'))));
  trigger.addEventListener('click',()=>{
    if (panel.matches(':popover-open')) panel.hidePopover();
    else { openMenu(); refresh(); }
  });
  window.addEventListener('resize',position,{passive:true});

  async function refresh() {
    const current = credential();
    if (!current) {
      generation++;
      verifying = null;
      if (user) { user = null; verifiedToken = ''; render(); }
      return;
    }
    if (verifying === current.token || (verifiedToken === current.token && Date.now()-verifiedAt < 30_000)) return;
    verifying = current.token;
    const attempt = ++generation;
    if (verifiedToken !== current.token) { user = null; render(); }
    try {
      const result = await accountRequest('session',{token:current.token});
      if (attempt !== generation || credential()?.token !== current.token) return;
      user = result.user;
      verifiedToken = user ? current.token : '';
      verifiedAt = Date.now();
      if (!user) localStorage.removeItem(sessionKey);
      error = '';
    } catch (e) {
      if (attempt !== generation || credential()?.token !== current.token) return;
      error = e.message;
    } finally {
      if (attempt === generation) { verifying = null; render(); }
    }
  }

  action.addEventListener('click',async ()=>{
    const signingOut = Boolean(user);
    busy = signingOut ? '正在退出…' : '正在打开飞书…';
    error = '';
    render();
    try {
      if (signingOut) {
        const token = credential()?.token;
        await accountRequest('logout',{method:'POST',token});
        if (!credential() || credential()?.token===token) localStorage.removeItem(sessionKey);
        generation++;
        verifying = null;
        user = null;
        verifiedToken = '';
        panel.hidePopover();
        refresh();
      } else {
        const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
        const result = await accountRequest('start',{method:'POST',body:{returnTo:location.href,challenge:await hash(verifier)}});
        const url = new URL(result.authorizeUrl);
        if (url.origin!=='https://accounts.feishu.cn' || url.pathname!=='/open-apis/authen/v1/authorize') throw Error('飞书验证地址无效，请重试。');
        sessionStorage.setItem(verifierKey,verifier);
        location.assign(url.href);
      }
    } catch (e) {
      error = e.message;
    } finally {
      busy = '';
      render();
    }
  });

  async function finishLogin(code,notice) {
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(verifierKey);
    history.replaceState(history.state,'',location.pathname+location.search);
    if (notice) {
      error = cancelMessages[notice] || '飞书验证未完成，请重试。';
      render();
      openMenu();
      return;
    }
    busy = '正在验证飞书账号…';
    render();
    openMenu();
    try {
      if (!tokenPattern.test(verifier || '') || !tokenPattern.test(code || '')) throw Error('登录已过期，请重新登录。');
      const result = await accountRequest('exchange',{method:'POST',body:{code,verifier}});
      if (!result.user?.name || !tokenPattern.test(result.token || '') || result.expiresAt <= Date.now()) throw Error('未收到有效的飞书登录状态。');
      localStorage.setItem(sessionKey,JSON.stringify({token:result.token,expiresAt:result.expiresAt}));
      generation++;
      verifying = null;
      user = result.user;
      verifiedToken = result.token;
      verifiedAt = Date.now();
      panel.hidePopover();
    } catch (e) {
      error = e.message;
    } finally {
      busy = '';
      render();
    }
  }

  render();
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('account_code') || fragment.has('account_error')) finishLogin(fragment.get('account_code'),fragment.get('account_error'));
  else refresh();
  window.addEventListener('focus',refresh);
  window.addEventListener('storage',event=>{ if (event.key===sessionKey) refresh(); });
  document.addEventListener('visibilitychange',()=>{if (!document.hidden) refresh();});
}

const root = document.getElementById('workspaceAccount');
if (root) mountAccount(root);
