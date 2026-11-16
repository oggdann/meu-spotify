"""Remove a inicialização automática. Preserva o histórico local do OGG."""
import os
from pathlib import Path
if os.name != "nt":
    raise SystemExit("Execute no Windows do OGG.")
import winreg
data = Path(os.environ["LOCALAPPDATA"]) / "OGG" / "SpotifyStats"
data.mkdir(parents=True, exist_ok=True)
(data / "parar.flag").touch()
with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE) as key:
    try:
        winreg.DeleteValue(key, "OGG Spotify Stats")
    except FileNotFoundError:
        pass
print("OGG Stats parado e removido da inicialização. Teu histórico local foi preservado.")
