# OGG • Minha frequência

Site pessoal de Daniel Victor (@oggdann): faixa atual, perfil, playlists próprias explicitamente públicas e histórico recente do Spotify.

## Rodar

Node 22 ou superior. Configure as três variáveis de `.env.example` no ambiente do processo. `npm run dev` abre em localhost:3000; `npm test` executa os testes. A Vercel entrega `public/` e as funções de `api/`.

## Reprodução

A seleção manual de YouTube é respeitada: se não houver correspondência ou o vídeo falhar, o áudio anterior é pausado e aparece uma mensagem com a opção explícita de escolher Spotify. Apenas o modo Automático tenta Spotify como reserva. O player informa o nome da faixa selecionada, separadamente da faixa atual do proprietário. Eventos atrasados dos iframes anteriores não retomam a reprodução durante a troca.

O modo Automático tenta a mesma faixa no player oficial do YouTube, sem exigir conta do Spotify. O vídeo e os controles permanecem visíveis; recolher o vídeo ou trocar de aba pausa o YouTube. O Spotify é alternativa quando não há correspondência ou o vídeo está indisponível. Nunca são iniciados dois players ao mesmo tempo. Bloqueios de autoplay ainda podem exigir interação do visitante. O botão “Ativar som” e os controles oficiais permanecem disponíveis. No Spotify, a sessão do visitante determina reprodução completa ou prévia. Nenhuma credencial do proprietário é entregue ao visitante.

`YOUTUBE_API_KEY`, opcional e somente no servidor, habilita a busca automática de outras faixas. Configure uma chave de projeto Google Cloud com YouTube Data API v3 ativada, restrita a essa API, diretamente nas variáveis Secret da Vercel, em Production e Preview. Não cole chaves no código. Sem ela, apenas as correspondências verificadas em `lib/youtube.js` usam YouTube; as outras faixas continuam no Spotify. A busca tenta até três consultas progressivas, com até 50 resultados por consulta: título completo e artista, título principal e artista, depois título principal. A palavra “audio” não é obrigatória. Compara título, artista, álbum e duração; admite subtítulos ausentes e “Ao Vivo” omitido quando há evidência do mesmo álbum no canal do artista ou em áudio distribuído oficialmente. Rejeita covers, gravações de duração incompatível e vídeos restritos. Não é uma garantia de gravação idêntica. A busca pública é limitada à faixa atual e às 30 recentes do dono, com deduplicação de vídeos e requisições simultâneas; para após a primeira correspondência aceita. Resultados positivos duram até 24 horas no cache; buscas sem resultado duram cinco minutos no servidor e um minuto no navegador. Observe a cota diária da API; não há extração de áudio nem uso de APIs não oficiais.

Referências dos áudios de distribuição oficial verificados: [Hobby + Gestão Inteligente](https://www.youtube.com/watch?v=lQUvn6nFqq0), [Shotta Flow Remix](https://www.youtube.com/watch?v=PX0pgsOA_tA), [Self Esteem](https://www.youtube.com/watch?v=YIEjlOhzcbk), [Клетка](https://www.youtube.com/watch?v=XSsRrlM3tNg) e [Helena Beat](https://www.youtube.com/watch?v=FlBCUzGLce0).

“Acompanhar trocas” segue as mudanças de faixa; não promete sincronização exata de tempo. Escolher uma playlist ou uma faixa recente desativa esse acompanhamento. O visitante pode retomá-lo.

## Dados e permissões

O token do proprietário precisa de `user-read-currently-playing` e `user-read-recently-played`. Playlists privadas e dados como e-mail, país e assinatura não são publicados. A listagem de playlists filtra `public === true` e o ID do proprietário. Um limite defensivo de 500 entradas por atualização tem indicador de truncamento.

As respostas públicas usam cache curto na CDN; tokens são reutilizados em instâncias aquecidas até a expiração. Falhas de autorização e indisponibilidade não fingem que o proprietário está offline. As chamadas têm timeout, repetição limitada para 401 e espera para 429. Os segredos ficam nas variáveis Secret da Vercel, nunca no repositório.

O logo orbital original está em `public/assets/ogg-orbital.png`. As cores usam a capa quando o navegador permite a leitura da imagem, com a cor OGG como alternativa. As barras são uma animação visual de reprodução, não uma medição do áudio.

O iframe API oficial do Spotify usa avaliação dinâmica de JavaScript. A CSP permite `unsafe-eval` para compatibilidade com esse SDK, mantém scripts inline bloqueados e restringe as origens de scripts. Nenhum HTML de metadados é injetado na página.

A autorização adicional do proprietário usa chave temporária de configuração, estado OAuth assinado, cookie HttpOnly e vínculo com o ID do perfil original. O resultado é criptografado para uma chave privada que não é publicada. Não há endpoint público de troca de credenciais do site.

O player do Spotify oferece “Entrar no Spotify” em uma nova aba na página oficial, com a faixa selecionada como destino, e “Já entrei · tentar novamente” para recriar o Embed e tentar a reprodução automática com a sessão do visitante. O site não coleta senhas nem usa a autorização do proprietário para o login dos visitantes. Fazer login não garante reprodução completa: conta, navegador, DRM e disponibilidade continuam sendo definidos pelo Spotify.

A faixa atual informa também a playlist de origem quando o contexto do Spotify é uma playlist e a API confirma que ela é pública. O bloco mostra nome e link “Abrir e salvar”; salvar é uma ação do visitante na página oficial. Contextos privados, indisponíveis e reprodução sem playlist não são publicados; falhas ao consultar essa informação não interrompem a faixa atual.

A identidade OGG aparece no início, na assinatura separada da capa, nos links de Instagram/Spotify, nos metadados e no crédito persistente do player. A logo original não cobre mais o nome do álbum. A capa pode ser tocada/acionada com teclado para alternar o modo imersivo. Paletas claras sobre fundo escuro são extraídas da capa; luzes, partículas e três cenas de movimento variam por faixa. A posição visual usa a linha do tempo do player ativo. São efeitos de capa, faixa e estado de reprodução, sem alegar análise de graves ou FFT do áudio dos iframes. O sistema respeita redução de movimento.
