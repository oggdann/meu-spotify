# OGG • Minha frequência

Site pessoal de Daniel Victor (@oggdann): faixa atual, perfil, playlists próprias explicitamente públicas e histórico recente do Spotify.

## Rodar

Node 22 ou superior. Configure as três variáveis de `.env.example` no ambiente do processo. `npm run dev` abre em localhost:3000; `npm test` executa os testes. A Vercel entrega `public/` e as funções de `api/`.

## Reprodução

O modo Automático tenta a mesma faixa no player oficial do YouTube, sem exigir conta do Spotify. O vídeo e os controles permanecem visíveis; recolher o vídeo ou trocar de aba pausa o YouTube. O Spotify é alternativa quando não há correspondência ou o vídeo está indisponível. Nunca são iniciados dois players ao mesmo tempo. Bloqueios de autoplay ainda podem exigir interação do visitante. O botão “Ativar som” e os controles oficiais permanecem disponíveis. No Spotify, a sessão do visitante determina reprodução completa ou prévia. Nenhuma credencial do proprietário é entregue ao visitante.

`YOUTUBE_API_KEY`, opcional e somente no servidor, habilita a busca automática de outras faixas. Configure uma chave de projeto Google Cloud com YouTube Data API v3 ativada, restrita a essa API, diretamente nas variáveis Secret da Vercel, em Production e Preview. Não cole chaves no código. Sem ela, apenas as correspondências verificadas em `lib/youtube.js` usam YouTube; as outras faixas continuam no Spotify. A busca compara título, artista e duração e rejeita versões alteradas, covers e vídeos restritos. Não é uma garantia de gravação idêntica. A busca pública é limitada à faixa atual e às 30 recentes do dono, com deduplicação e cache por faixa de até 24 horas. Observe a cota diária da API; não há extração de áudio nem uso de APIs não oficiais.

Referências dos áudios de distribuição oficial verificados: [Hobby + Gestão Inteligente](https://www.youtube.com/watch?v=lQUvn6nFqq0), [Shotta Flow Remix](https://www.youtube.com/watch?v=PX0pgsOA_tA), [Self Esteem](https://www.youtube.com/watch?v=YIEjlOhzcbk), [Клетка](https://www.youtube.com/watch?v=XSsRrlM3tNg) e [Helena Beat](https://www.youtube.com/watch?v=FlBCUzGLce0).

“Acompanhar trocas” segue as mudanças de faixa; não promete sincronização exata de tempo. Escolher uma playlist ou uma faixa recente desativa esse acompanhamento. O visitante pode retomá-lo.

## Dados e permissões

O token do proprietário precisa de `user-read-currently-playing` e `user-read-recently-played`. Playlists privadas e dados como e-mail, país e assinatura não são publicados. A listagem de playlists filtra `public === true` e o ID do proprietário. Um limite defensivo de 500 entradas por atualização tem indicador de truncamento.

As respostas públicas usam cache curto na CDN; tokens são reutilizados em instâncias aquecidas até a expiração. Falhas de autorização e indisponibilidade não fingem que o proprietário está offline. As chamadas têm timeout, repetição limitada para 401 e espera para 429. Os segredos ficam nas variáveis Secret da Vercel, nunca no repositório.

O logo orbital original está em `public/assets/ogg-orbital.png`. As cores usam a capa quando o navegador permite a leitura da imagem, com a cor OGG como alternativa. As barras são uma animação visual de reprodução, não uma medição do áudio.

O iframe API oficial do Spotify usa avaliação dinâmica de JavaScript. A CSP permite `unsafe-eval` para compatibilidade com esse SDK, mantém scripts inline bloqueados e restringe as origens de scripts. Nenhum HTML de metadados é injetado na página.

A autorização adicional do proprietário usa chave temporária de configuração, estado OAuth assinado, cookie HttpOnly e vínculo com o ID do perfil original. O resultado é criptografado para uma chave privada que não é publicada. Não há endpoint público de troca de credenciais do site.
