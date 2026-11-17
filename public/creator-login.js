(() => {
 const form=document.getElementById('creator-login-form'),input=document.getElementById('creator-code'),status=document.getElementById('creator-login-status'),button=form.querySelector('button');
 form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;status.textContent='Conectando seu acesso…';
  try{const response=await fetch('/api/presenca?acao=criador',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:input.value.trim()}),signal:AbortSignal.timeout(15000)});input.value='';if(!response.ok)throw Error(response.status===403?'Esse código expirou ou já foi utilizado. Solicite um novo acesso privado.':'Não foi possível entrar agora. Tente novamente.');location.replace('/#presenca');}
  catch(error){status.textContent=error.message;button.disabled=false;}
 });
 if(location.hash.length>1){input.value=location.hash.slice(1);history.replaceState(null,'',location.pathname);form.requestSubmit();}
})();
