# OGG Spotify Stats

Registro da escuta para o site do OGG. Roda na conta atual do Windows, sem administrador, consulta o estado público do Spotify no site a cada 15 segundos e envia um resumo a cada minuto. Inicia junto com o login no Windows.

O histórico fica em `%LOCALAPPDATA%\OGG\SpotifyStats\historico.sqlite3`. A credencial de envio é exclusiva deste coletor, não dá acesso à conta do Spotify e fica protegida pelo Windows DPAPI. Nenhuma credencial do Spotify é instalada no computador.

## O que os números significam

- Semana: segunda-feira até agora, no horário da Bahia.
- Mês: primeiro dia do mês até agora, no horário da Bahia.
- Minutos: avanço de reprodução observado, sem contar pausas, saltos ou intervalos sem monitoramento. Trocas ambíguas de faixa ficam de fora.
- Plays: sessões acompanhadas por pelo menos 30 segundos.
- Artistas: artista principal de cada faixa, ordenado pelo tempo registrado.

O computador precisa estar ligado, com a sessão do Windows e conexão ativas. O coletor acompanha a conta do OGG mesmo se a reprodução estiver em outro dispositivo. Não recupera automaticamente os minutos de antes da instalação nem os períodos em que ficou desligado. O total pode diferir do cálculo interno do aplicativo Spotify.

## Instalação

Baixe `instalar.py` deste site e execute com o Python oficial do Windows. Use o código privado de instalação fornecido na conversa. O código é temporário, não deve entrar no GitHub e não deve ser compartilhado com visitantes. O instalador verifica o SHA-256 do coletor antes de executar.

## Histórico anterior

Quando tiver a exportação oficial do Spotify, importe um único conjunto de arquivos JSON ou o ZIP do mesmo pedido, com:

```powershell
py "$env:LOCALAPPDATA\OGG\SpotifyStats\coletor.py" --importar "C:\caminho\historico.zip"
```

Somente data, duração, música e artista são lidos. IP, localização e outros dados do arquivo não são armazenados. Importações repetidas do mesmo arquivo e observações sobrepostas não duplicam os minutos. Aguarde a próxima atualização do coletor.

## Conferir ou remover

```powershell
py "$env:LOCALAPPDATA\OGG\SpotifyStats\coletor.py" --status
py "$env:LOCALAPPDATA\OGG\SpotifyStats\desinstalar.py"
```

O desinstalador para o coletor e remove a inicialização automática. Preserva o banco de histórico. Não desliga nem altera o Spotify.
