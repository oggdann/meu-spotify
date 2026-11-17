/* OGG community: public cards, verified creator controls, server-side permissions. */
(() => {
  const feed=$('presence-wall'),more=$('more-presences'),sort=$('mural-sort');
  let rows=[],cursor=null,loading=false,generation=0,queued=false;
  const openThreads=new Map(),editors=new Map();
  const requestId=()=>crypto.randomUUID();
  const owner=()=>Boolean(presenceSession?.owner);
  const token=()=>owner()?presenceSession?.csrf:presenceSession?.guest?.csrf||presenceSession?.csrf;
  function notice(message){$('mural-feedback').textContent=message||'';}
  async function json(url,options={}){
    const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(18000),...options});
    let body;try{body=await r.json();}catch{}
    if(!r.ok)throw Object.assign(new Error(body?.error||'unavailable'),{code:body?.error,status:r.status});
    return body;
  }
  function message(error){
    return error.status===403?'Ação não autorizada. Confira a conta conectada.':error.status===429?'Muitas ações em sequência. Aguarde um pouco.':error.code==='identity_not_proven'?'A presença só pode ser identificada no navegador em que foi publicada.':error.code==='name_required'?'Informe seu nome para responder.':'Não foi possível concluir agora. Tente novamente.';
  }
  async function act(action,body){
    if(!token())await refresh();
    const data=await json('/api/mural?acao='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,csrf:token()})});
    if(data.entry)rows=rows.map(row=>row.id===data.entry.id?{...data.entry,previews:(data.entry.previews||[]).map(preview=>preview.metadataAvailable===false?(row.previews||[]).find(old=>old.url===preview.url)||preview:preview)}:row);
    notice('');return data;
  }
  function syncSession(){
    const signed=Boolean(presenceSession?.profile);
    $('presence-login').hidden=signed||!presenceSession?.enabled;
    $('presence-session').hidden=!signed;
    if(signed){$('presence-greeting').textContent=(owner()?'OGG | Criador · ':'Conta conectada: ')+presenceSession.profile.name;const image=safeUrl(presenceSession.profile.image,true);$('presence-user-image').hidden=!image;if(image)$('presence-user-image').src=image;}
    $('owner-login').hidden=owner();$('owner-logout').hidden=!owner();$('owner-access-label').textContent=owner()?'OGG | Criador · conectado':'Acesso do criador';
    $('owner-composer').hidden=!owner();$('guest-form').hidden=owner();
    $('mural-moderation-option').hidden=!owner();updateGuestControls();
  }
  async function refresh(append=false){
    if(loading){if(!append)queued=true;return;}loading=true;more.disabled=true;const id=++generation;
    try{
      if(!append){presenceSession=await json('/api/presenca?acao=eu');syncSession();}
      const data=await json('/api/mural?acao=listar&ordem='+encodeURIComponent(sort.value||'recentes')+(append&&cursor?'&cursor='+encodeURIComponent(cursor):''));
      if(id!==generation)return;
      const incoming=data.items||[];
      rows=append?[...rows,...incoming.filter(row=>!rows.some(old=>old.id===row.id))]:incoming;
      cursor=data.next;presenceItems=[...rows];if(data.own&&!presenceItems.some(row=>row.id===data.own.id))presenceItems.push(data.own);
      render();syncSession();
    }catch(error){if(error.code==='refresh_required'&&append){cursor=null;notice('Atualize o mural para ver as novas publicações.');}else notice('Mural temporariamente indisponível. As publicações continuam salvas.');}
    finally{loading=false;more.disabled=false;if(queued){queued=false;refresh();}}
  }
  function button(label,fn,className='mural-action'){
    const b=el('button',className,label);b.type='button';b.addEventListener('click',()=>fn(b));return b;
  }
  function likeButton(item,parentId,replyId){
    const b=button((item.liked?'♥ ':'♡ ')+(item.likeCount||0),async control=>{
      control.disabled=true;
      try{await act('curtir',{id:parentId,replyId,liked:!item.liked});if(replyId)await loadReplies(parentId,false);render();}
      catch(error){notice(message(error));control.disabled=false;}
    });
    b.setAttribute('aria-label',(item.liked?'Descurtir':'Curtir')+' comentário');b.setAttribute('aria-pressed',String(Boolean(item.liked)));return b;
  }
  function editor(item,parentId,replyId){
    const key=parentId+':'+(replyId||''),value=editors.get(key);
    if(value===undefined)return null;
    const form=el('form','mural-editor'),input=el('textarea');input.value=value;input.maxLength=1000;input.rows=3;input.setAttribute('aria-label','Editar comentário');input.addEventListener('input',()=>editors.set(key,input.value));
    const save=el('button','mural-action','Salvar alteração');save.type='submit';
    form.append(input,save,button('Cancelar',()=>{editors.delete(key);render();}));
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{await act('editar',{id:parentId,replyId,text:input.value});editors.delete(key);if(replyId)await loadReplies(parentId,false);render();}catch(error){notice(message(error));save.disabled=false;}});
    return form;
  }
  function admin(item,parentId,replyId){
    const details=el('details','mural-admin'),summary=el('summary','','Gerenciar');details.append(summary);
    details.append(button('Editar',()=>{editors.set(parentId+':'+(replyId||''),item.comment||'');render();}));
    if(!item.removed)details.append(button(item.hidden?'Mostrar':'Ocultar',async()=>{
      if(!confirm(item.hidden?'Mostrar este comentário novamente?':'Ocultar este comentário do mural?'))return;
      try{await act('ocultar',{id:parentId,replyId,hidden:!item.hidden});if(replyId)await loadReplies(parentId,false);else await refresh();render();}catch(error){notice(message(error));}
    }));
    if(!item.removed)details.append(button('Excluir',async()=>{
      if(!confirm('Remover este comentário do mural? O histórico de moderação será preservado.'))return;
      try{await act('excluir',{id:parentId,replyId});if(replyId)await loadReplies(parentId,false);else await refresh();render();}catch(error){notice(message(error));}
    }));
    if(!replyId&&(item.instagramUrl||item.spotifyUrl))details.append(button('Atualizar prévias',async control=>{control.disabled=true;try{await act('previews',{id:parentId});render();}catch(error){notice(message(error));control.disabled=false;}}));
    if(item.canClaim&&!replyId)details.append(button('Identificar como minha presença',async()=>{
      if(!confirm('Confirmar que esta presença foi publicada por você neste navegador?'))return;
      try{await act('identificar',{id:parentId});await refresh();}catch(error){notice(message(error));}
    }));
    return details;
  }
  async function loadReplies(id,append=false){
    const old=openThreads.get(id)||{items:[],next:null,open:true};
    const data=await json('/api/mural?acao=respostas&id='+encodeURIComponent(id)+(append&&old.next!==null?'&offset='+old.next:''));
    openThreads.set(id,{open:true,items:append?[...old.items,...data.items.filter(r=>!old.items.some(p=>p.id===r.id))]:data.items,next:data.next});return data;
  }
  function replyForm(parent){
    const form=el('form','mural-reply-form'),label=el('label','','Responder'),name=el('input'),input=el('textarea'),send=el('button','mural-action','Enviar resposta');
    name.placeholder='Seu nome';name.maxLength=60;name.value=presenceSession?.profile?.name||presenceItems.find(p=>p.id===presenceSession?.guest?.id)?.name||$('guest-name').value||'';name.required=true;name.setAttribute('aria-label','Seu nome');
    input.maxLength=1000;input.rows=2;input.required=true;input.placeholder='Escreva sua resposta';input.setAttribute('aria-label','Resposta');send.type='submit';label.append(input);if(!owner())form.append(name);form.append(label,send);
    let key=requestId();form.addEventListener('submit',async event=>{
      event.preventDefault();send.disabled=true;
      try{await act('responder',{id:parent.id,text:input.value,name:name.value,requestId:key});key=requestId();await loadReplies(parent.id,false);render();}
      catch(error){notice(message(error));send.disabled=false;}
    });return form;
  }
  function card(item,parentId=item.id,replyId){
    const avatar=item.creator?state.library?.profile?.image||item.image:item.image;
    const node=presenceCard({...item,image:avatar});node.classList.add(replyId?'presence-reply':'community-card');node.dataset.commentId=item.id;
    if(item.creator)node.classList.add('is-creator');
    if(item.hidden||item.removed)node.append(el('small','mural-state',item.removed?'Removido do mural':'Oculto'));
    if(item.editedAt)node.append(el('small','mural-state',item.moderationEdit?'Editado pela moderação':'Editado'));
    const actions=el('div','mural-actions');actions.append(likeButton(item,parentId,replyId));
    if(!replyId)actions.append(button('Respostas '+(item.replyCount||0),async()=>{
      const thread=openThreads.get(item.id);
      if(thread?.open){thread.open=false;render();return;}
      try{await loadReplies(item.id,false);render();}catch(error){notice(message(error));}
    }));
    if(owner())actions.append(admin(item,parentId,replyId));node.append(actions);
    const edit=editor(item,parentId,replyId);if(edit)node.append(edit);
    if(!replyId&&openThreads.get(item.id)?.open){
      const thread=openThreads.get(item.id),section=el('div','mural-replies');
      thread.items.forEach(reply=>section.append(card(reply,item.id,reply.id)));
      if(thread.next!==null)section.append(button('Ver mais respostas',async()=>{try{await loadReplies(item.id,true);render();}catch(error){notice(message(error));}}));
      section.append(replyForm(item));node.append(section);
    }
    return node;
  }
  function render(){
    feed.replaceChildren();rows.forEach(row=>feed.append(card(row)));
    if(!rows.length)feed.append(el('p','presence-empty',(sort.value==='ocultos'?'Nenhum conteúdo oculto.':'O mural tá aberto. O próximo nome pode ser o teu.')));
    more.hidden=!cursor;updateGuestControls();
  }
  sort.addEventListener('change',()=>{cursor=null;refresh();});
  more.addEventListener('click',()=>{if(cursor)refresh(true);});
  let ownerRequest=requestId();
  $('owner-logout').addEventListener('click',()=>presenceAction('sair'));
  $('owner-publish').addEventListener('click',async()=>{
    const b=$('owner-publish');b.disabled=true;
    try{await act('publicar',{text:$('owner-comment').value,requestId:ownerRequest});ownerRequest=requestId();$('owner-comment').value='';await refresh();}
    catch(error){notice(message(error));}finally{b.disabled=false;}
  });
  window.oggCommunity={refresh,render};refresh();
})();
