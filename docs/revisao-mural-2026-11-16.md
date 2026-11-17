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

## Fotos dos comentários — complemento publicado após confirmação
As fotos agora viram avatar do próprio comentário, inclusive registros antigos e respostas, sem regravar ou apagar o texto. Prioridade: foto pública do Instagram informado, perfil Spotify ou perfil do criador da playlist, foto já existente e capa da playlist; quando indisponíveis, avatar local neutro. A falha de carregamento de uma imagem tenta a próxima automaticamente, sem travar o mural. Ambos os links sociais e suas prévias continuam visíveis.
O nome de usuário é normalizado para HTTPS (ex.: @oggdann → https://www.instagram.com/oggdann/). Para playlists, a relação music:creator ou author/creator estruturado determina somente um link público Spotify /user/ validado; a foto vem dos metadados públicos desse perfil, sem Spotify Web API, login, execução no PC ou uso de secret no cliente. A capa não substitui o criador quando sua foto está disponível.
A atualização progressiva do mural consulta no máximo dois links-base sem cache por página; uma playlist pode exigir adicionalmente a página pública do seu criador. Cache de metadados v3: sucesso1h/falha5min. Instagram pode bloquear metadados/foto; nenhum dado privado é acessado e não é possível garantir fotos reais de todos. O fallback local assegura que todos os comentários tenham avatar.
Validação:120 testes Node passaram, incluindo prioridade das fontes, origem segura do criador, cache e recuperação por falha de imagem no navegador simulado. Teste de metadados públicos da SUPRASSUMO encontrou o criador ogg e sua foto; @oggdann normalizado corretamente. Nenhuma postagem real de teste foi criada.

## Correções posteriores: links, foto prioritária, selo e respostas compactas
Pedidos mais recentes do Dan substituem a fixação antiga: comentários do criador mantêm selo e autenticação própria, mas seguem a ordenação normal de data/curtidas/respostas. Filtro do criador permanece disponível. Respostas agora mostram avatar, nome, selo e texto com links sociais pequenos, sem repetir as prévias grandes dos perfis/playlist do comentário principal.
Dono autenticado ganha Gerenciar → Editar links e foto em comentários e respostas existentes. Instagram aceita qualquer @user ou user e normaliza para HTTPS; Spotify aceita perfil/playlist. Edições ficam na camada de moderação com histórico privado de links anteriores, sem alterar autor, selo, data, texto ou registros originais. Permissões e CSRF são exigidos no servidor. Atualizar prévias agora revalida os metadados em cache em vez de devolver a mesma cópia antiga.
Instagram continua sendo a primeira opção para o avatar; Spotify é fallback. Diagnóstico real do perfil público de exemplo: Instagram respondeu302 para /accounts/login/ e não entregou metadados nem imagem. Isso é bloqueio externo de consulta, não prova de perfil privado; não afirmar que a foto pode ser extraída automaticamente em todos os casos. Opção de informar URL direta da foto no painel do dono cobre bloqueio/ausência de metadados sem acesso privado ou dependência do PC. Somente URLs HTTPS dos CDNs Instagram/Meta autorizados são aceitas nesse campo. A foto manual do Instagram também tem prioridade sobre Spotify, e erros de imagem continuam tentando a próxima fonte.
Validação:126 testes completos aprovados antes do último teste de interação; o teste adicional executa o script real do mural em DOM simulado, abre o editor do dono, envia novos links comCSRF e confirma respostas compactas. A bateria final registra127 testes. Nenhuma publicação de teste foi feita em produção. Revisão restante deYouTube/estatísticas continua agendada para23:45Bahia.

## Acesso de criador independente da quota e metadados reais
No Chrome conectado do Dan foi reproduzido o bloqueio: a tentativa de entrar como criador retornava ao mural como visitante, com mensagem de quota do Spotify e próxima tentativa11:33PM Bahia. A ausência de Gerenciar era sessão sem papel de dono, não remoção dos comentários.
Novo acesso privado em /criador, usando código assinado de finalidade restrita, expiração10min e uso único. Código fica no fragmento do link e é removido antes de autenticar porPOST; não aparece na URL enviada ao servidor. Autenticidade depende de OGG_CREATOR_LOGIN_KEY exclusivo do servidor, criado como variável sensível de produção; não reutiliza o clientsecretSpotify nem fornece poder por nome, badge ou link. A sessão emitida é a sessão existente, HttpOnly/Secure/SameSite=Lax e24h, com CSRF e identidade fixa do proprietário. Consumo atômico em Blob privado impede replay; falha do armazenamento não emite sessão. A chave de assinatura e os códigos não são gravados em fonte, relatório ou artefatos públicos. Códigos são emitidos apenas por manutenção autenticada do projeto; /criador não emite códigos para visitantes.
Importação de metadados Instagram: parser e cards aceitam seguidores, seguindo, publicações, nome, descrição e foto quando a página pública efetivamente os fornecer. Contagens abreviadas ficam abreviadas, sem fabricar exatidão; ausência de dados não vira0. Cache de metadadosv4. Diagnóstico permanece: Instagram redireciona a leitura pública para login, portanto importação automática completa AINDA NÃO RESOLVIDA somente com@/URL. Não alegar que parser/avatar de fallback equivale a integração. Projeto não tem token/contaMeta configurados; a contaMetricool consultada também não tem Instagram conectado. APIoficial exige token e limita BusinessDiscovery a contas elegíveis de empresa/criador; não promete ler qualquer perfil pessoal. Fonte: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/v21.0/?locale=pt_BR
Validação:133 testes aprovados, incluindo rejeição de acesso expirado/adulterado/reutilizado/cross-site, cookie e papel real de dono sem nenhuma chamada aoSpotify, falha deBlob sem conceder acesso e metadados decontagem/foto quando disponíveis. Comentários continuam com selo semfixação, respostas compactas e todos os controles protegidos. Verificação final na sessão real ainda deve conferir Gerenciar em todos os comentários e abrir/cancelar editores sem criar publicações de teste.

## Tentativas adicionais de importação e adaptador pronto
A pedido do Dan (“tente de todo jeito” / continuar enquanto dorme), foram testadas fontes adicionais sem exportar cookies ou executar dependência noPC: Microlink público retornou400/EPROXYNEEDED exigindoPro; endpointweb de perfilInstagram semsessão retornou429; Meta oEmbed públicov27 retornou400/Permissions error para URL deperfil. Não insistir enquanto limitados. Nenhumaassinatura/conta paga foi criada.
NoChrome conectado, o perfil davi_makenzy_ mostrou foto e cabeçalho com621seguidores/537seguindo; isto confirma que dados visíveis na sessão NÃO significam que obackend público consiga importá-los. Não copiar cookies doInstagram para servidor/provedor e não alegar automação de dados a partir dessa leitura manual.
Foi preparado fallback opcional exclusivamente no servidor viaMicrolink com MICROLINK_API_KEY (ausente, portanto INATIVO). Consulta somente URLcanônicaInstagram permitida, chave só emheaderparaendpointfixopro.microlink.io, negaoutrasorigens, rejeitalogin/perfil diferente/logo genérica, aproveitaapenas metadadosreais, preservaabreviações e respeita429/Retry-Aftercomcooldown. Cachev5. Configurarchave/comercializaçãoouaprovarintegraçãoMeta ainda depende doDan; NÃO ativarplano pago nem assinartermos semautorização.
Teste adicional doadaptador eescopodeURLs passou; suíte completa final135testes. O acesso real dedono foi comprovado noChrome em16/16comentários, comediçãode links/texto abertaecanceladasemmudarregistros. Não reimplantar autofixação nem prévias grandes em respostas.

## Revisão de 17/11/2026 — recuperação do YouTube e faixa relatada
A versão de produção conferida no início era027df794d5ecc64a31fee6702bff68ee7f301211, com implantaçãoREADY. As funções já concluídas do mural, acesso do criador, layout, links, avatares e players foram preservadas.

### Dados reais conferidos
- Música atual200: “Outfit Valioso”, com contextoSUPRASSUMO, capa e link da playlist.
- Biblioteca200: SUPRASSUMO eEu Sei Das Coisa, ambas com capas reais; foto do perfil disponível; histórico ready com50reproduções.
- Estatísticas200: recentAvailability e top.availability ready, amostra50, retryAfter0. exactMinutesAvailability permanece not_provided_by_spotify_api. Recortes recentes não representam histórico completo; não foram criados totais fictícios.
- Mural200:16registros, sem criação de comentário de teste nem modificação de conteúdo de visitantes.
- YouTube deixou de retornar youtube_rate_limited na amostra. Isso comprova recuperação observada, não garante que novas cotas nunca sejam atingidas.

### Amostra real pequena, sem áudio no computador de Dan
| Faixa | Resultado do resolvedor | Vídeo | Evidência adicional |
| --- | --- | --- | --- |
| Outfit Valioso | title_artist_duration | GBzhdLPxWoc | oEmbed200, título/artistascompatíveis |
| Last Night on Earth — Green Day | title_artist_duration | oVZg-WwgivI | oEmbed200, Warner Music Thailand |
| We Are The People — The Shapeshifters Vocal Remix | title_artist_duration | Y1jEPr0p-Gg | oEmbed200, nome da versão remix preservado |
| Melô a vida tá demais — Deson Melo | title_artist_duration na execução de manutenção | XKbsBTy-91k | Topic do artista, distribuiçãoDistroKid, público/incorporável/permitidoBR,1:45 |

OSpotify identificou a faixa problemática como0iJegPYlXgSQFBINaaVssM, duração104902ms (1:44,9). Ela já não estava entre as50recentes do site; a conferência usou o mesmo resolvedor em manutenção, sem abrir o endpoint público para buscas arbitrárias. A YouTubeDataAPI confirmou Melô a vida tá demais no canal“deson melo - Topic”, ID XKbsBTy-91k, duraçãoPT1M45S, statuspublic eembeddable, Brasil na lista permitida, e descrição“Provided to YouTube by DistroKid”. Link: https://www.youtube.com/watch?v=XKbsBTy-91k .

### Alteração mínima e testes
Adicionada somente essa correspondência validada ao mapa existente verifiedVideos. Essa faixa agora dispensa nova pesquisa noGoogle e não fica dependente da cota de busca; as regras gerais de título/artista/duração/versão/região continuam inalteradas. Dois testes novos verificam o registroTopic, rejeição de velocidade/BR bloqueado e resposta pública sem qualquer chamada aoSpotify/YouTube quando provedores estão indisponíveis. Total137testesNodeaprovados; gitdiff--check sem erros.
Os IDs dinâmicos das outras três faixas continuam usando o cache compartilhado existente; não foi ampliado o número de consultas nem removida a proteção do buscador público. Nenhum segredo foi gravado no código ou relatório. Nenhum componente foi instalado noPC.

### Limites e pendências
Não houve reprodução de áudio noChrome pessoal enquanto Dan dormia, nem teste realSafari/iPhone/navegadorInstagram nesta rodada. Metadados, filtro de incorporação/região e oEmbed não comprovam autoplay audível no navegador.
A importação completa e automática dos metadadosInstagram continua pendente de chave/fonteautorizada; o adaptador opcional permanece inativo semMICROLINK_API_KEY. Os bloqueios302/429 e a exigência dePro já foram diagnosticados antes; não foram repetidos nem houve assinatura/conta paga/transferência de cookies. Fotos públicas não fornecidas continuam comfallback; prioridadeInstagram e segundaopçãoSpotify preservadas.
O commit e a implantação finais desta rodada ficam registrados no relatórioOGG_Relatorio_YouTube_2026-11-16.md da conversa após concluir a publicação.
