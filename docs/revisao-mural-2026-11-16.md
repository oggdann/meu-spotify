# Revisão OGG — 16/11/2026

## Entregue nesta revisão
- Curtidas/descurtidas persistentes, idempotentes e com concorrência protegida por ETag.
- Respostas em um nível, contagem pública real, abertura/recolhimento e carregamento por páginas.
- Filtros recentes, antigos, curtidos, respondidos e criador; comentários principais autenticados do dono sempre antes dos visitantes, em ordem recente, inclusive na paginação.
- Publicação e resposta como OGG | Criador, apenas para sessão Spotify do proprietário validada no servidor.
- Identificação de presença anônima antiga somente quando a sessão autenticada do dono e o navegador original comprovam o vínculo. Nome, foto ou URL iguais não concedem privilégios.
- Ocultar, mostrar, excluir e editar comentários/respostas, com confirmação na interface, autorização no servidor, CSRF/origem e histórico privado da moderação. Edições de terceiros têm aviso público.
- Cards individuais compactos em uma coluna, com altura natural e controles tocáveis no celular.
- Instagram e Spotify em cards independentes, incluindo fallback com link funcional para plataformas bloqueadas.
- Open Graph/oEmbed e JSON-LD públicos: autor, quantidade de faixas, duração e seguidores somente quando a página realmente fornece esses campos. Nenhum dado privado ou número inferido.
- Controle do dono para atualizar as prévias de comentários antigos.
- Preservados: mural permanente, datas reais, @usuario automático, remoção própria, identidade visual, foto pública, duas playlists selecionadas, players e miniplayer. Nenhum registro existente foi apagado nem comentário real de teste publicado.

## Validação
114 testes Node passaram, incluindo regressões existentes, concorrência, permissões, auditoria, identidade autenticada, metadados, filtros e paginação.
Chromium na nuvem: 390 × 844 e 1440 × 1000, visitante/criador; formulário, links, curtidas, respostas, edição, publicação simulada do dono e prioridade em filtros. Zero erros de JavaScript e zero rolagem horizontal nas quatro combinações.
Os testes de interface usaram respostas locais simuladas; não equivalem a um teste no Safari real do iPhone. Escritas reais de visitantes/admin não foram disparadas contra o mural de produção.

## Pendências e bloqueios
Spotify Web API retornava QUOTA_EXCEEDED para histórico e rankings; YouTube retornava youtube_rate_limited. Respeitar Retry-After; não ampliar chamadas enquanto bloqueadas. A conferência das APIs e de áudio real fica para a tarefa de 23:45 America/Bahia.
O dono precisa da sessão Spotify autenticada de sua própria conta para usar moderação. Se não estiver conectado e a quota bloquear /me, aguardar liberação. Não conceder acesso por @username digitado.
Para vincular uma presença anônima antiga, entrar como dono no navegador original e confirmar a identificação. As demais entradas exigem essa prova para receber selo; a confirmação explícita documentada abaixo é a exceção autorizada para o registro exato do criador.
Minutos exatos semanais/mensais não são fornecidos pelos endpoints usados; não fabricar totais.
O ambiente Work estava indisponível. A implementação/testes foram executados numa sessão temporária da Vercel, sem depender do PC do usuário.
O relatório anterior da Library estava na versão 5; este documento e o checkpoint da tarefa contêm o estado posterior.

## Confirmação do comentário antigo e acesso
Dan confirmou expressamente nesta conversa a entrada “ogg dono da parada”, comentário “salve da korea”. O identificador exato dessa entrada foi vinculado à identificação visual do criador por manutenção autorizada do projeto. Isso não concede privilégios administrativos à sessão anônima nem a quem copie nome ou links.
Acesso do criador fica visível no mural e exige autenticação da conta Spotify do proprietário. Layout e interações se aplicam às entradas antigas sem apagá-las. Prévias antigas são enriquecidas progressivamente com cache, limitando a dois links sem cache por carregamento do mural; links bloqueados mantêm prévia simples. O dono também pode atualizar as prévias manualmente.
