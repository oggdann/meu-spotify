"""Instalador OGG Stats. Sem administrador, só para a conta Windows atual.

Inicia o coletor agora e no login. Consultas a cada 15 s; resumos a cada minuto.
Credencial de envio protegida com Windows DPAPI. Histórico fica no próprio PC.
"""
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = "https://oggspotify.vercel.app"
COLLECTOR_SHA256 = "53cfc8c6a73b0dfd4422753317996126fc515d542024526f83c0cd934bed84fa"

def main():
    if os.name != "nt":
        raise SystemExit("Execute no Windows do OGG, na tua conta de usuário.")
    print("OGG Spotify Stats · registro contínuo")
    print("Vai iniciar no login deste Windows, sem administrador.")
    print("Envia apenas minutos e rankings para o teu site. Para remover, execute desinstalar.py.")
    code = getpass.getpass("Código de instalação privado (não aparece ao digitar): ").strip()
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(ROOT + "/api/coletor", headers={"Authorization":"Bearer "+code,"User-Agent":"OGG-Stats-Installer/1.0"})
    try:
        with opener.open(request, timeout=20) as response:
            config = json.loads(response.read(32768))
    except Exception:
        raise SystemExit("Não consegui ativar. O código pode ter expirado; peça um novo ao OGG.")
    if config.get("version") != 1 or config.get("ownerId") != "dq78sjzflg084c1ibpjuo8gjc" or config.get("pollUrl") != ROOT+"/api/musica" or config.get("uploadUrl") != ROOT+"/api/coletor" or not config.get("token"):
        raise SystemExit("Configuração inesperada. Instalação interrompida.")
    with opener.open(ROOT+"/coletor/coletor.py", timeout=20) as response:
        source = response.read(1000000)
    if hashlib.sha256(source).hexdigest() != COLLECTOR_SHA256:
        raise SystemExit("A versão do coletor mudou. Baixe o instalador atualizado e tente de novo.")
    data = Path(os.environ["LOCALAPPDATA"]) / "OGG" / "SpotifyStats"
    data.mkdir(parents=True, exist_ok=True)
    (data/"parar.flag").touch()
    import msvcrt
    lock=(data/"execucao.lock").open("a+b")
    for attempt in range(100):
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
            break
        except OSError:
            time.sleep(.5)
    else:
        lock.close()
        raise SystemExit("O coletor anterior ainda está encerrando. Aguarde um minuto e execute novamente.")
    target = data/"coletor.py"
    temporary = data/"coletor-novo.py"
    temporary.write_bytes(source)
    temporary.replace(target)
    spec = importlib.util.spec_from_file_location("ogg_collector", target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    protected = module.dpapi(json.dumps({"token":config["token"]}).encode())
    if json.loads(module.dpapi(protected,decrypt=True)).get("token") != config["token"]:
        raise SystemExit("Não foi possível proteger a configuração neste Windows.")
    (data/"config.dat").write_bytes(protected)
    with opener.open(ROOT+"/coletor/desinstalar.py", timeout=20) as response:
        (data/"desinstalar.py").write_bytes(response.read(100000))
    (data/"parar.flag").unlink(missing_ok=True)
    python = Path(sys.executable)
    pythonw = python.with_name("pythonw.exe")
    if not pythonw.exists():
        raise SystemExit("pythonw.exe não encontrado. Instale o Python oficial completo e tente novamente.")
    command = '"'+str(pythonw)+'" "'+str(target)+'"'
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run") as key:
        winreg.SetValueEx(key,"OGG Spotify Stats",0,winreg.REG_SZ,command)
    lock.seek(0)
    msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
    lock.close()
    subprocess.Popen([str(pythonw),str(target)],cwd=str(data),creationflags=subprocess.CREATE_NO_WINDOW)
    print("Instalado e iniciado. Confira a primeira atualização no site em cerca de um minuto.")
    print("O PC precisa ficar ligado e conectado. Antes de hoje, só com a exportação de histórico do Spotify.")
    print("Histórico e desinstalador:",data)

if __name__ == "__main__":
    main()
