"""Produce a local ZIP/CRX3, or a key-free ZIP for Microsoft Edge Add-ons."""
from pathlib import Path
import zipfile, json, subprocess, hashlib, argparse

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / 'YouTube中文同传'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--edge-store', action='store_true', help='Create an unsigned Edge Add-ons ZIP without manifest.key; keep the source manifest unchanged.')
args = parser.parse_args()
subprocess.run(['node', str(ROOT / 'tools' / 'build-syntax.cjs')], check=True)
if not args.edge_store:
    subprocess.run(['node', str(ROOT / 'tools' / 'sign-crx.cjs'), '--prepare'], check=True)
manifest = json.loads((EXT / 'manifest.json').read_text('utf-8'))
version = manifest['version']
if args.edge_store:
    archive = DIST / f'youtube-progress-dub-v{version}-edge-store.zip'
    # Write only a copy of the manifest; local installation identity stays intact.
    source_manifest = (EXT / 'manifest.json').read_bytes()
    store_manifest = dict(manifest)
    store_manifest.pop('key', None)
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
        for file in sorted(EXT.rglob('*')):
            if file.is_file():
                name = file.relative_to(EXT).as_posix()
                if name == 'manifest.json':
                    z.writestr(name, json.dumps(store_manifest, ensure_ascii=False, indent=2) + '\n')
                else:
                    z.write(file, name)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert json.loads(z.read('manifest.json')) == store_manifest
        assert 'key' not in store_manifest
        for file in EXT.rglob('*'):
            if file.is_file() and file.name != 'manifest.json':
                assert z.read(file.relative_to(EXT).as_posix()) == file.read_bytes(), file
        assert not any(Path(n).suffix.lower() in {'.pem', '.key', '.pfx', '.p12'} for n in z.namelist())
    assert (EXT / 'manifest.json').read_bytes() == source_manifest
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.sha256.txt').write_text(f'{digest}  {archive.name}\n', 'utf-8')
    print(json.dumps({'archive': str(archive), 'version': version, 'target': 'edge-store', 'keyRemoved': True, 'sourceManifestUnchanged': True, 'verified': True, 'sha256': digest}, ensure_ascii=False, indent=2))
    raise SystemExit(0)
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
