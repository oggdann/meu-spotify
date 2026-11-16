import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('ogg_collector',Path(__file__).resolve().parents[1]/'public/coletor/coletor.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NOW=1794830400000  # 2026-11-16T12:00Z

def item(at, progress, playing=True, track='1'*22, duration=180000):
    return {'checkedAt':at,'progressMs':progress,'isPlaying':playing,'hasTrack':True,'id':track,'title':'Song',
            'primaryArtist':'Artist','artists':[{'id':'2'*22,'name':'Artist'}],'durationMs':duration,'songUrl':'https://open.spotify.com/track/'+track}

class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'history.sqlite3'
        self.recorder=module.Recorder(self.path,NOW)
    def tearDown(self):
        self.recorder.db.close()
        self.tmp.cleanup()
    def total(self, now=NOW+60000):
        return self.recorder.snapshot(now)['periods'][0]
    def test_pauses_seeks_and_cached_responses_do_not_inflate_minutes(self):
        self.recorder.observe(item(NOW,10000))
        self.recorder.observe(item(NOW+15000,25000))
        self.recorder.observe(item(NOW+15000,25000))
        self.recorder.observe(item(NOW+30000,30000,False))
        self.recorder.observe(item(NOW+45000,30000,False))
        self.recorder.observe(item(NOW+60000,160000))  # Seek ignored.
        self.assertEqual(self.total()['heardMs'],20000)
        self.assertEqual(self.total()['plays'],0)
    def test_restart_deduplicates_and_keeps_progress(self):
        self.recorder.observe(item(NOW,0))
        self.recorder.observe(item(NOW+15000,15000))
        self.recorder.db.close()
        self.recorder=module.Recorder(self.path,NOW)
        self.recorder.observe(item(NOW+15000,15000))
        self.recorder.observe(item(NOW+30000,30000))
        self.assertEqual(self.total()['heardMs'],30000)
        self.assertEqual(self.total()['plays'],1)
    def test_long_offline_gap_is_not_counted(self):
        self.recorder.observe(item(NOW,0))
        self.recorder.observe(item(NOW+120000,120000))
        self.assertEqual(self.total(NOW+120000)['heardMs'],0)
    def test_automatic_track_boundary_is_split_without_duplicate_minutes(self):
        self.recorder.observe(item(NOW,175000))
        self.recorder.observe(item(NOW+15000,10000,track='3'*22))
        self.assertEqual(self.total()['heardMs'],15000)
        self.assertEqual(len(self.total()['tracks']),2)
    def test_period_boundaries_use_bahia_calendar_and_prorate(self):
        midnight=int(module.datetime(2026,11,16,tzinfo=module.BAHIA).timestamp()*1000)
        self.recorder.observe(item(midnight-10000,0))
        self.recorder.observe(item(midnight+5000,15000))
        result=self.total(midnight+5000)
        self.assertEqual(result['start'],midnight)
        self.assertEqual(result['heardMs'],5000)
    def test_official_import_deduplicates_and_replaces_overlapping_observations(self):
        self.recorder.observe(item(NOW,0))
        self.recorder.observe(item(NOW+15000,15000))
        source=Path(self.tmp.name)/'history.json'
        source.write_text(json.dumps([{'ts':module.datetime.fromtimestamp((NOW+15000)/1000,module.timezone.utc).isoformat(),'ms_played':15000,'spotify_track_uri':'spotify:track:'+'1'*22,'master_metadata_track_name':'Song','master_metadata_album_artist_name':'Artist','ip_addr':'must-not-store'}]))
        self.assertEqual(self.recorder.import_history(source),1)
        self.assertEqual(self.recorder.import_history(source),0)
        self.assertEqual(self.total()['heardMs'],15000)
        self.assertNotIn('must-not-store',str(self.recorder.snapshot(NOW+60000)))
    def test_installer_pin_matches_exact_collector_source(self):
        source=Path(module.__file__)
        installer=source.with_name('instalar.py').read_text()
        self.assertIn(module.hashlib.sha256(source.read_bytes()).hexdigest(),installer)

if __name__=='__main__':
    unittest.main()
