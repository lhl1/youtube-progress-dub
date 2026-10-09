"""Create and verify a non-overwriting local rollback archive before editing."""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'YouTube中文同传/manifest.json').read_text('utf-8'))
stamp = datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d-%H%M%S-%f')
folder = ROOT / 'backups'
folder.mkdir(exist_ok=True)
archive = folder / f'YouTube中文同传-v{manifest["version"]}-{stamp}.zip'
files = []
for name in ['YouTube中文同传', 'tests', 'tools', 'dist']:
    files.extend(p for p in (ROOT / name).rglob('*') if p.is_file())
files.extend(ROOT.glob('*.md'))
files.extend(ROOT / name for name in ['package.json', 'package-lock.json'] if (ROOT / name).exists())
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(set(files)):
        z.write(p, p.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for p in files:
        assert hashlib.sha256(z.read(p.relative_to(ROOT).as_posix())).digest() == hashlib.sha256(p.read_bytes()).digest(), p
result = {'backup': str(archive), 'verified': True, 'files': len(set(files)), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
archive.with_suffix('.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
