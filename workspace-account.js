import {mountWorkspaceLogin} from './workspace-login.js?v=20261127-restore-session';

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
  permission:'此账号暂未开通工作台权限，请联系管理员。',
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

async function serviceRequest(path,{method='GET',token,body,file,asBlob=false,timeout=12000,unavailable='账号验证暂不可用，请稍后重试。'}={}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer '+token;
  if (body) headers['Content-Type'] = 'application/json';
  if (file) headers['Content-Type'] = file.type || 'application/octet-stream';
  let response;
  try {
    response = await fetch(service+'/api/'+path,{method,headers,body:file || (body && JSON.stringify(body)),
      cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(timeout)});
  } catch {
    throw Error(unavailable);
  }
  if (response.status===401 && token && token===profileToken) {
    window.dispatchEvent(new Event('workbench-session-invalid'));
  }
  if (response.ok && asBlob) return response.blob();
  const result = await response.json().catch(()=>null);
  if (!response.ok || !result || typeof result!=='object') throw Object.assign(Error(result?.error || unavailable),{status:response.status,revision:result?.revision});
  return result;
}

const accountRequest = (path,options) => serviceRequest('account/'+path,options);

export function requestWorkbenchComments(path,options) {
  return serviceRequest(path,{...options,token:credential()?.token,unavailable:'留言暂不可用，请稍后重试。'});
}

export function requestWorkbenchWorkspace(path,options) {
  return serviceRequest('workspace/'+path,{...options,token:credential()?.token,unavailable:'暂时连不上工作台保存服务。'});
}

export function currentWorkbenchAccount() {
  return credential()?.token===profileToken ? verifiedProfile : null;
}

export function showWorkbench() {
  if (!currentWorkbenchAccount()) return false;
  document.body.classList.remove('account-gated','account-opening');
  return true;
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
  const gated = document.body.classList.contains('account-gated');
  const fragment = new URLSearchParams(location.hash.slice(1));
  let exchanging = fragment.has('account_code') && !fragment.has('account_error');
  if (gated && (credential() || exchanging)) document.body.classList.add('account-opening');
  const renderLogin = gated ? mountWorkspaceLogin(()=>runAccountAction(false),refresh) : null;
  let user = null, busy = '', error = '', verifiedToken = '', verifiedAt = 0, generation = 0, verifying, expiryTimer;
  let initialized = false, finishReady, retryTimer, retryDelay = 1500;
  const ready = new Promise(resolve=>{finishReady=resolve;});

  function settleInitialAccount() {
    if (initialized || (gated && !user && credential())) return;
    initialized = true;
    finishReady();
  }

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
      role.textContent = user.role==='editor' ? '管理员' : '可留言';
      identity.append(name,role);
      summary.replaceChildren(avatar(user),identity);
    } else summary.textContent = '登录画板账号';
    message.textContent = error;
    message.hidden = !error;
    action.textContent = busy || (user ? '退出登录' : '使用公司飞书登录');
    action.disabled = Boolean(busy);
    action.classList.toggle('sign-in',!user);
    if (renderLogin) {
      const restoring = !exchanging && !user && Boolean(credential());
      renderLogin({user,busy,error,opening:exchanging||Boolean(user)||restoring,retry:restoring&&Boolean(error)});
    }
    const token = user ? verifiedToken : '';
    if (profileToken!==token || verifiedProfile?.name!==user?.name || verifiedProfile?.avatar!==user?.avatar || verifiedProfile?.role!==user?.role) {
      const sessionChanged = profileToken!==token;
      profileToken = token;
      verifiedProfile = user;
      clearTimeout(expiryTimer);
      if (user) expiryTimer=setTimeout(refresh,Math.max(0,(credential()?.expiresAt||0)-Date.now()+100));
      const open = !document.body.classList.contains('account-gated');
      if (gated && sessionChanged && (open || (initialized && user))) {
        document.body.classList.add('account-gated');
        document.body.classList.toggle('account-opening',Boolean(user||credential()));
        panel.hidePopover();
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
        location.reload();
        return;
      }
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
    if (exchanging) return;
    clearTimeout(retryTimer);
    const current = credential();
    if (!current) {
      generation++;
      verifying = null;
      user = null;
      verifiedToken = '';
      render();
      settleInitialAccount();
      return;
    }
    if (verifying === current.token || (verifiedToken === current.token && Date.now()-verifiedAt < 30_000)) return;
    verifying = current.token;
    const attempt = ++generation;
    if (verifiedToken !== current.token) { user = null; error = ''; render(); }
    try {
      const result = await accountRequest('session',{token:current.token});
      if (attempt !== generation || credential()?.token !== current.token) return;
      if (result.user!==null && (!result.user?.name || !['editor','member'].includes(result.user.role))) {
        throw Error('账号验证暂不可用，请稍后重试。');
      }
      user = result.user;
      verifiedToken = user ? current.token : '';
      verifiedAt = Date.now();
      if (!user) localStorage.removeItem(sessionKey);
      retryDelay = 1500;
      error = user ? '' : '登录已失效，请重新登录。';
    } catch (e) {
      if (attempt !== generation || credential()?.token !== current.token) return;
      error = e.message;
      if (e.status === 401) {
        localStorage.removeItem(sessionKey);
        user = null;
        verifiedToken = '';
      }
    } finally {
      if (attempt === generation) {
        verifying = null;
        render();
        settleInitialAccount();
        if (gated && !user && error && credential()) {
          retryTimer = setTimeout(refresh,retryDelay);
          retryDelay = Math.min(retryDelay*2,15000);
        }
      }
    }
  }

  async function runAccountAction(signingOut) {
    if (busy || (Boolean(user)!==signingOut)) return;
    busy = signingOut ? '正在退出…' : '正在打开飞书…';
    error = '';
    let navigating = false;
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
      } else {
        const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
        const result = await accountRequest('start',{method:'POST',body:{returnTo:location.href,challenge:await hash(verifier)}});
        const url = new URL(result.authorizeUrl);
        if (url.origin!=='https://accounts.feishu.cn' || url.pathname!=='/open-apis/authen/v1/authorize') throw Error('飞书验证地址无效，请重试。');
        sessionStorage.setItem(verifierKey,verifier);
        location.assign(url.href);
        navigating = true;
      }
    } catch (e) {
      error = e.message;
    } finally {
      if (!navigating) {
        busy = '';
        render();
      }
    }
  }
  action.addEventListener('click',()=>runAccountAction(Boolean(user)));

  async function finishLogin(code,notice) {
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(verifierKey);
    history.replaceState(history.state,'',location.pathname+location.search);
    if (notice) {
      error = cancelMessages[notice] || '飞书验证未完成，请重试。';
      render();
      if (!gated) openMenu();
      return;
    }
    busy = '正在验证飞书账号…';
    render();
    if (!gated) openMenu();
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
  if (fragment.has('account_code') || fragment.has('account_error')) {
    finishLogin(fragment.get('account_code'),fragment.get('account_error')).then(()=>{
      exchanging = false;
      if (!user && credential()) refresh();
      else {render();settleInitialAccount();}
    });
  } else refresh();
  window.addEventListener('focus',refresh);
  window.addEventListener('online',refresh);
  window.addEventListener('pageshow',event=>{
    if (!event.persisted) return;
    busy = '';
    render();
    refresh();
  });
  window.addEventListener('storage',event=>{ if (event.key===sessionKey) refresh(); });
  window.addEventListener('workbench-session-invalid',()=>{
    if (credential()?.token===verifiedToken) localStorage.removeItem(sessionKey);
    error = '登录已失效，请重新登录。';
    refresh();
  });
  document.addEventListener('visibilitychange',()=>{if (!document.hidden) refresh();});
  return ready;
}

const root = globalThis.document?.getElementById('workspaceAccount');
export const workbenchAccountReady = root ? mountAccount(root) : Promise.resolve();
