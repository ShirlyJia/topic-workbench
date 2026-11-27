import {richEditorMarkup,mountRichEditors,destroyRichEditors,flushRichEditors,readRichEditor,richHasContent,richHTML} from './rich-text.js';
import {currentWorkbenchAccount,feishuAvatarSource,openWorkbenchAccount,requestWorkbenchComments} from './workspace-account.js?v=20261127-login-design';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const imageData = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function identity(actor) {
  const name=actor?.name || '飞书成员', value=actor?.avatar;
  const source = typeof value==='string' && value.length<=32800 && imageData.test(value) ? value : feishuAvatarSource(value);
  return '<span class="signed-identity"><span class="signed-avatar" aria-hidden="true">'+esc([...name][0])+
    (source?'<img alt="" referrerpolicy="no-referrer" src="'+esc(source)+'">':'')+'</span><span>'+esc(name)+'</span></span>';
}

function formMarkup(draft,busy,{account,editing=false}={}) {
  const label=editing?'编辑留言':'记录新信息';
  return '<form class="comment-composer" data-'+(editing?'signed-edit':'signed-new')+(busy?' inert':'')+'><div class="inline-field">'+
    richEditorMarkup({label,value:draft.text,html:draft.html,placeholder:'记下想法、讨论或进展…',collapsible:!editing})+
    '</div><div class="comment-compose-actions">'+(account?identity(account):'')+'<input name="title" aria-label="记录标题" maxlength="120" placeholder="标题（选填）" value="'+esc(draft.title)+'">'+
    '<button type="submit">'+(editing?'保存':'记一条 ↗')+'</button>'+
    (editing?'<button type="button" class="signed-cancel" data-signed-cancel>取消</button>':'')+'</div></form>';
}

function cardMarkup(record,edit,busy) {
  const time = Number.isFinite(Date.parse(record.createdAt)) ?
    '<time datetime="'+esc(record.createdAt)+'">'+esc(date.format(new Date(record.createdAt)))+'</time>':'';
  const actions = record.canEdit && !edit ? '<div class="comment-actions cloud-comment-actions">'+
    '<button type="button" data-signed-edit-id="'+esc(record.id)+'">编辑</button>'+
    '<button type="button" data-signed-remove="'+esc(record.id)+'" aria-label="删除这条留言">删除</button></div>':'';
  return '<article class="comment-entry signed-comment"><header><div class="comment-meta">'+identity(record.actor)+time+'</div>'+actions+'</header>'+
    (edit?formMarkup(edit,busy,{editing:true}):(record.title?'<strong class="signed-title">'+esc(record.title)+'</strong>':'')+
      '<div class="signed-comment-body rich-content">'+richHTML(record.html,record.body)+'</div>')+'</article>';
}

const cardOrder = (a,b)=>b.createdAt.localeCompare(a.createdAt);
const composeForm = view=>view.host.querySelector('[data-signed-new]');
const readForm = form=>({...readRichEditor(form.querySelector('.rich-editor-input')),title:form.elements.title.value});

export function createSignedComments({notify}) {
  const projects = new Map();
  let active = null;

  function status(view,message='',retry=false) {
    const node=view.host.querySelector('[data-signed-status]');
    node.querySelector('span').textContent=message;
    node.querySelector('button').hidden=!retry;
    node.hidden=!message;
  }

  function capture(view) {
    const form=composeForm(view), editing=view.list.querySelector('[data-signed-edit]');
    if (form) view.data.draft=readForm(form);
    if (editing && view.data.edit) Object.assign(view.data.edit,readForm(editing));
  }

  function wireRich(root) {
    root.querySelectorAll('.signed-avatar img').forEach(image=>{
      if (image.complete && !image.naturalWidth) image.remove();
      else image.addEventListener('error',()=>image.remove(),{once:true});
    });
    mountRichEditors(root,{onError:notify});
  }

  function renderComposer(view) {
    const account=currentWorkbenchAccount();
    if (view.localComposer) view.localComposer.hidden=Boolean(account);
    destroyRichEditors(view.host);
    const login=!account && !view.localComposer ? '<button type="button" data-signed-login>飞书登录后留言</button>' : '';
    view.host.innerHTML=(account?formMarkup(view.data.draft,view.data.busy,{account}):login)+
      '<div class="signed-comment-status" data-signed-status hidden><span role="status"></span><button type="button" data-signed-retry hidden>重试</button></div>';
    wireRich(view.host);
    if (view.data.error) status(view,view.data.error,true);
    else if (view.data.busy) status(view,'正在保存留言…');
  }

  function renderList(view) {
    const {data,list}=view;
    const edit=currentWorkbenchAccount()?data.edit:null;
    destroyRichEditors(list);
    list.innerHTML=data.entries.map(record=>cardMarkup(record,edit?.id===record.id?edit:null,data.busy)).join('');
    wireRich(list);
  }

  async function load(view) {
    const {data,pid}=view;
    if (data.loading || data.busy) return;
    data.loading=true;
    const revision=data.revision;
    try {
      const {comments}=await requestWorkbenchComments('projects/'+encodeURIComponent(pid)+'/comments');
      if (revision!==data.revision || data.busy) return;
      data.entries=Array.isArray(comments)?comments:[];
      data.loaded=Date.now();
      data.error='';
      if (active?.data===data && !data.edit) renderList(active);
      if (active?.data===data) status(active);
    } catch (e) {
      if (revision!==data.revision || data.busy) return;
      data.error=e.message;
      if (active?.data===data) status(active,data.error,true);
    } finally {
      data.loading=false;
    }
  }

  async function write(view,form,removeId) {
    const {data,pid}=view, edit=form?.hasAttribute('data-signed-edit')?data.edit:null;
    if (data.busy || !currentWorkbenchAccount() || (form && !flushRichEditors(form))) return;
    const draft=form?readForm(form):null;
    if (draft && !richHasContent(draft)) {
      status(view,'请填写留言。');
      form.querySelector('.rich-editor-input').focus();
      return;
    }
    capture(view);
    const id=removeId || edit?.id;
    const writeId=id || (data.writeId ||= 'signed-'+crypto.randomUUID());
    const options=removeId?{method:'DELETE'}:{
      method:edit?'PATCH':'POST',
      body:{id:writeId,title:draft.title,body:draft.text,html:draft.html,...(edit?{version:edit.version}:{})}
    };
    data.busy=true;
    data.revision++;
    for (const node of [composeForm(view),view.list.querySelector('[data-signed-edit]')]) {
      if (node) node.inert=true;
    }
    status(view,'正在保存留言…');
    try {
      const path=id?'comments/'+id:'projects/'+encodeURIComponent(pid)+'/comments';
      const result=await requestWorkbenchComments(path,options);
      if (!removeId && !result.comment) throw Error('未能确认留言已保存，请重试。');
      if (removeId) data.entries=data.entries.filter(row=>row.id!==id);
      else data.entries=[...data.entries.filter(row=>row.id!==result.comment.id),result.comment].sort(cardOrder);
      if (edit || (removeId && removeId===data.edit?.id)) data.edit=null;
      else if (!removeId) { data.draft={};data.writeId=''; }
      data.busy=false;
      if (active?.data===data) {
        if (!edit && !removeId) renderComposer(active);
        renderList(active);
        status(active);
      }
      notify(removeId?'留言已删除':'留言已保存');
    } catch (e) {
      if (active?.data===data) status(active,e.message);
      else notify(e.message);
    } finally {
      data.busy=false;
      if (form) form.inert=false;
      if (active?.data===data) {
        for (const node of [composeForm(active),active.list.querySelector('[data-signed-edit]')]) {
          if (node) node.inert=false;
        }
      }
    }
  }

  function detach() {
    if (!active) return;
    capture(active);
    active.controller.abort();
    destroyRichEditors(active.host);
    destroyRichEditors(active.list);
    active=null;
  }

  function attach(pid,root) {
    const host=root.querySelector('[data-signed-composer]'),list=root.querySelector('[data-signed-list]');
    if (!host || !list || !/^[\w:-]{1,160}$/.test(pid)) return;
    if(!projects.has(pid)) projects.set(pid,{draft:{},entries:[],revision:0});
    const data=projects.get(pid),controller=new AbortController();
    const view=active={pid,host,list,controller,data,localComposer:root.querySelector('#commentForm')};
    const listen=(node,type,fn)=>node.addEventListener(type,fn,{signal:controller.signal});
    function submit(event) {
      if (!event.target.matches('[data-signed-new],[data-signed-edit]')) return;
      event.preventDefault();
      write(view,event.target);
    }
    listen(host,'submit',submit);
    listen(list,'submit',submit);
    listen(host,'click',event=>{
      if (event.target.closest('[data-signed-login]')) openWorkbenchAccount();
      if (event.target.closest('[data-signed-retry]')) load(view);
    });
    listen(list,'click',event=>{
      const button=event.target.closest('button');
      if (!button || data.busy) return;
      if (button.hasAttribute('data-signed-cancel')) {data.edit=null;renderList(view);return;}
      const selected=button.dataset.signedEditId || button.dataset.signedRemove;
      const record=data.entries.find(row=>row.id===selected && row.canEdit);
      if (!record) return;
      if (button.dataset.signedRemove) {
        if (window.confirm('删除这条留言？')) write(view,null,record.id);
        return;
      }
      data.edit={id:record.id,title:record.title,text:record.body,html:record.html,version:record.version};
      renderList(view);
      list.querySelector('[data-signed-edit] .rich-editor-input')?.focus();
    });
    renderComposer(view);
    renderList(view);
    if (!data.loaded || Date.now()-data.loaded>15_000) load(view);
  }

  window.addEventListener('workbench-account-changed',()=>{
    if (!active) {projects.clear();return;}
    const {pid,host}=active,root=host.closest('.comment-pool');
    detach();
    projects.clear();
    if (root) attach(pid,root);
  });
  window.addEventListener('focus',()=>{
    if (active && !active.data.edit && Date.now()-(active.data.loaded||0)>15_000) load(active);
  });

  return {attach,detach};
}
