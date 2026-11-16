"""OGG Spotify Stats. Registra progresso observado; nunca inventa histórico.

Somente biblioteca padrão. Configuração protegida pelo DPAPI do usuário Windows.
O PC consulta os dados públicos do site e envia apenas resumos semanais/mensais.
"""
import argparse
import bisect
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.request
import uuid
import zipfile
from datetime import datetime, timedelta, timezone

ROOT = "https://oggspotify.vercel.app"
BAHIA = timezone(timedelta(hours=-3))
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "OGG" / "SpotifyStats"
MAX_GAP = 45000


def dpapi(data, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("A configuração protegida precisa do Windows.")
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    output = Blob()
    crypt = ctypes.windll.crypt32
    if decrypt:
        fn = crypt.CryptUnprotectData
        fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        fn = crypt.CryptProtectData
        fn.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(source), "OGG Spotify Stats", None, None, None, 1, ctypes.byref(output))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        free = ctypes.windll.kernel32.LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(output.pbData)


def request_json(url, token=None, body=None):
    if url not in (ROOT + "/api/musica", ROOT + "/api/coletor"):
        raise ValueError("Destino inválido.")
    headers = {"User-Agent": "OGG-Stats/1.0", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    # Nunca encaminhar a credencial para um redirecionamento de outro domínio.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        return json.loads(response.read(131072))


class Recorder:
    def __init__(self, path, now=None):
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS segments (
                start INTEGER NOT NULL, end INTEGER NOT NULL, heard INTEGER NOT NULL,
                session TEXT NOT NULL, track TEXT NOT NULL,
                PRIMARY KEY (end,session));
            CREATE INDEX IF NOT EXISTS segments_end ON segments(end);
            CREATE TABLE IF NOT EXISTS imported (
                id TEXT PRIMARY KEY, start INTEGER NOT NULL, end INTEGER NOT NULL,
                heard INTEGER NOT NULL, track TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS imported_end ON imported(end);
        """)
        if not self.meta("startedAt"):
            self.set_meta("startedAt", int(now or time.time() * 1000))
        self.db.commit()

    def meta(self, key):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_meta(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(value)))

    @staticmethod
    def track(item):
        artists = item.get("artists") or []
        primary = artists[0] if artists else {}
        return {"id": item.get("id") or item.get("uri"), "title": str(item.get("title") or "Sem título")[:300],
                "artist": str(item.get("primaryArtist") or primary.get("name") or item.get("artist") or "Artista")[:180],
                "artistId": primary.get("id"), "durationMs": max(0, int(item.get("durationMs") or 0)),
                "songUrl": item.get("songUrl"), "albumImageUrl": item.get("albumImageUrl")}

    def observe(self, item):
        at = int(item.get("checkedAt") or 0)
        if at <= 0:
            return
        previous = self.meta("observation")
        if previous and at <= previous["at"]:
            return  # Mesma resposta do cache, ou resposta fora de ordem.
        current = {"at": at, "track": self.track(item), "progress": max(0, int(item.get("progressMs") or 0)),
                   "playing": bool(item.get("hasTrack") and item.get("isPlaying") and item.get("type") != "episode"), "session": uuid.uuid4().hex}
        valid = previous and 0 < at - previous["at"] <= MAX_GAP
        same = valid and previous["track"]["id"] and previous["track"]["id"] == current["track"]["id"]
        if same:
            delta = current["progress"] - previous["progress"]
            current["session"] = previous["session"] if delta >= 0 else current["session"]
            if (current["playing"] or previous["playing"]) and 0 < delta <= at - previous["at"] + 1500:
                self.segment(at - delta, at, delta, current["session"], current["track"])
        elif valid and current["playing"] and previous["playing"]:
            # A passagem automática pode ser recuperada quando o fim + início
            # batem com o intervalo observado. Trocas ambíguas ficam de fora.
            tail = previous["track"]["durationMs"] - previous["progress"]
            total = tail + current["progress"]
            if 0 <= tail <= MAX_GAP and 0 < total <= MAX_GAP and abs(total - (at - previous["at"])) <= 1500:
                if tail:
                    self.segment(at - current["progress"] - tail, at - current["progress"], tail, previous["session"], previous["track"])
                if current["progress"]:
                    self.segment(at - current["progress"], at, current["progress"], current["session"], current["track"])
        self.set_meta("observation", current)
        self.db.commit()

    def segment(self, start, end, heard, session, track):
        if track["id"] and 0 < heard <= MAX_GAP:
            self.db.execute("INSERT OR IGNORE INTO segments VALUES (?,?,?,?,?)", (start, end, heard, session, json.dumps(track)))

    def import_history(self, path):
        path = Path(path)
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as archive:
                documents = [json.loads(archive.read(info)) for info in archive.infolist()
                             if info.filename.lower().endswith(".json") and info.file_size <= 50000000]
        else:
            documents = [json.loads(path.read_text(encoding="utf-8-sig"))]
        count = 0
        for document in documents:
            if not isinstance(document, list):
                continue
            for row in document:
                if not isinstance(row, dict):
                    continue
                try:
                    heard = int(row.get("ms_played", row.get("msPlayed", 0)))
                    raw = row.get("ts") or row.get("endTime")
                    if not raw or not 0 < heard <= 86400000:
                        continue
                    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    end = int(parsed.timestamp() * 1000)
                    if end > int(time.time() * 1000) + 300000:
                        continue
                    title = row.get("master_metadata_track_name") or row.get("trackName")
                    artist = row.get("master_metadata_album_artist_name") or row.get("artistName")
                    if not title or not artist:
                        continue
                    uri = row.get("spotify_track_uri") or ""
                    match = re.fullmatch(r"spotify:track:([A-Za-z0-9]{22})", uri)
                    track_id = match.group(1) if match else hashlib.sha256((str(title)+"|"+str(artist)).encode()).hexdigest()
                    track = {"id": track_id, "title": str(title)[:300], "artist": str(artist)[:180],
                             "artistId": None, "songUrl": "https://open.spotify.com/track/"+track_id if match else None,
                             "albumImageUrl": None, "durationMs": 0}
                    key = hashlib.sha256((track_id+":"+str(end)+":"+str(heard)).encode()).hexdigest()
                    cursor = self.db.execute("INSERT OR IGNORE INTO imported VALUES (?,?,?,?,?)", (key, end-heard, end, heard, json.dumps(track)))
                    count += cursor.rowcount
                    if end - heard < self.meta("startedAt"):
                        self.set_meta("startedAt", end-heard)
                except (ValueError, TypeError, OverflowError):
                    continue
        self.db.commit()
        return count

    def snapshot(self, now=None):
        now = int(now or time.time() * 1000)
        local = datetime.fromtimestamp(now / 1000, BAHIA)
        midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
        starts = [(7, midnight-timedelta(days=local.weekday())), (30, midnight.replace(day=1))]
        periods = []
        for days, start_date in starts:
            start = int(start_date.timestamp()*1000)
            imports = self.db.execute("SELECT start,end,heard,id,track FROM imported WHERE end>? AND start<?", (start, now)).fetchall()
            segments = self.db.execute("SELECT start,end,heard,session,track FROM segments WHERE end>? AND start<?", (start, now)).fetchall()
            # Exportação oficial substitui observações sobrepostas; não duplica minutos.
            intervals = []
            for beginning, end, *_ in sorted(imports):
                if intervals and beginning <= intervals[-1][1]:
                    intervals[-1][1] = max(end, intervals[-1][1])
                else:
                    intervals.append([beginning, end])
            bounds = [interval[0] for interval in intervals]
            def overlaps(segment):
                index = bisect.bisect_left(bounds, segment[1]) - 1
                return index >= 0 and intervals[index][1] > segment[0]
            rows = imports + [segment for segment in segments if not overlaps(segment)]
            tracks, artists, sessions = {}, {}, {}
            total = 0
            for beginning, end, heard, session, raw in rows:
                overlap = max(0, min(end, now)-max(beginning, start))
                duration = min(heard, round(heard*overlap/max(1, end-beginning)))
                if not duration:
                    continue
                track = json.loads(raw)
                total += duration
                sessions[session] = sessions.get(session, 0) + duration
                artist_key = track["artist"].casefold().strip()
                artist_url = "https://open.spotify.com/artist/"+track["artistId"] if track.get("artistId") else None
                for group, key, info in ((tracks, track["id"], {"title":track["title"],"name":track["artist"],"songUrl":track.get("songUrl"),"albumImageUrl":track.get("albumImageUrl")}),
                                         (artists, artist_key, {"name":track["artist"],"url":artist_url})):
                    entry = group.setdefault(key, {**info,"heardMs":0,"sessions":set()})
                    entry["heardMs"] += duration
                    entry["sessions"].add(session)
                    if not entry.get("url") and artist_url and group is artists:
                        entry["url"] = artist_url
            top = lambda group: [{**{k:v for k,v in row.items() if k!="sessions"}, "count":len(row["sessions"])}
                                 for row in sorted(group.values(),key=lambda row:row["heardMs"],reverse=True)[:5]]
            periods.append({"days":days,"start":start,"end":max(start+1,now),"heardMs":total,
                            "plays":sum(value>=30000 for value in sessions.values()),"artists":top(artists),"tracks":top(tracks)})
        return {"version":1,"mode":"playback_progress","updatedAt":now,"startedAt":self.meta("startedAt"),"periods":periods}


def main():
    parser = argparse.ArgumentParser(description="OGG · registro contínuo de escuta")
    parser.add_argument("--importar", metavar="JSON_OU_ZIP")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    recorder = Recorder(DATA / "historico.sqlite3")
    if args.importar:
        print("Registros novos importados:", recorder.import_history(args.importar))
    if args.status:
        snapshot = recorder.snapshot()
        print("Semana:", snapshot["periods"][0]["heardMs"]//60000, "min · Mês:", snapshot["periods"][1]["heardMs"]//60000, "min")
        return
    if os.name != "nt":
        raise RuntimeError("Use o instalador no Windows.")
    import msvcrt
    lock = (DATA / "execucao.lock").open("a+b")
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return
    config = json.loads(dpapi((DATA / "config.dat").read_bytes(), decrypt=True))
    last_upload = 0
    while not (DATA / "parar.flag").exists():
        try:
            recorder.observe(request_json(ROOT + "/api/musica"))
            if time.monotonic() - last_upload >= 60:
                request_json(ROOT + "/api/coletor", token=config["token"], body=recorder.snapshot())
                last_upload = time.monotonic()
                (DATA / "status.json").write_text(json.dumps({"updatedAt":int(time.time()*1000),"ok":True}), encoding="utf-8")
        except Exception:
            # Sem token, URLs privadas ou respostas de autenticação no log.
            (DATA / "status.json").write_text(json.dumps({"updatedAt":int(time.time()*1000),"ok":False}), encoding="utf-8")
        for _ in range(15):
            if (DATA / "parar.flag").exists():
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
