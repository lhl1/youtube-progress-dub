"""Produce an installable zip and a signed CRX3 without third-party dependencies."""
from pathlib import Path
import zipfile, json, subprocess, hashlib

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / 'YouTube中文同传'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
subprocess.run(['node', str(ROOT / 'tools' / 'build-syntax.cjs')], check=True)
subprocess.run(['node', str(ROOT / 'tools' / 'sign-crx.cjs'), '--prepare'], check=True)
manifest = json.loads((EXT / 'manifest.json').read_text('utf-8'))
version = manifest['version']
archive = DIST / f'YouTube中文同传-v{version}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for file in sorted(EXT.rglob('*')):
        if file.is_file():
            z.write(file, file.relative_to(EXT).as_posix())
    z.testzip()
subprocess.run(['node', str(ROOT / 'tools' / 'sign-crx.cjs'), str(archive)], check=True)
files = [archive, archive.with_suffix('.crx')]
lines = [f'{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}' for f in files]
(DIST / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n', 'utf-8')
print('\n'.join(str(f) for f in files))
