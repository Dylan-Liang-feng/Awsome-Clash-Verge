"""Build the x64 AI installer from an explicit set of verified inputs. Run on Windows."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NSIS = ROOT / "src-tauri/packages/windows"
WEBVIEW = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
LOCKED = {
    "resources/Country.mmdb": ("country.mmdb", "145ce5dfb812d8de28547e6289bb5c5f8b3df2f1dea21d324d5b575e0431311f"),
    "resources/ASN.mmdb": ("asn.mmdb", "81565a450281c949fc83745f5ec9cfea70b035163b1152b055645884765d153d"),
    "resources/geoip.dat": ("geoip.dat", "eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2"),
    "resources/geosite.dat": ("dlc.dat", "e0faf80467eee504d3b13bf7fe95a7eac2076905b0f42efc83d15eaf8e0dd955"),
    WEBVIEW: (WEBVIEW, "47bc51387aff95c1275ce38cfbbb5fbab99b43b33214049877bbcdbcc7a970d5"),
}
UPSTREAM = (
    "verge-mihomo.exe", "verge-mihomo-alpha.exe",
    "resources/clash-verge-service.exe",
    "resources/clash-verge-service-install.exe",
    "resources/clash-verge-service-uninstall.exe",
)

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binary", "upstream", "data", "makensis", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    payload = out / "payload"
    payload.mkdir()
    hashes = {r["path"]: r["sha256"].lower() for r in json.loads((ROOT / "scripts/upstream-files.json").read_text())}
    inputs = {name: (args.upstream / name, hashes[name]) for name in UPSTREAM}
    inputs.update({name: (args.data / file, sha) for name, (file, sha) in LOCKED.items()})
    inputs["clash-verge.exe"] = args.binary, None
    for name in ("LICENSE", "THIRD_PARTY.md", "PRIVACY.md", "docs/offline-licenses/domain-list-MIT.txt"):
        inputs[name] = ROOT / name, None
    install, uninstall, manifest = [], [], {}
    for name, (source, expected) in inputs.items():
        dest = payload / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
        sha = digest(dest)
        if expected and sha != expected:
            raise ValueError("SHA-256 mismatch: " + name)
        manifest[name] = sha
        if name != WEBVIEW:
            relative = Path(name)
            directory = "$INSTDIR" if relative.parent == Path(".") else "$INSTDIR\\" + str(relative.parent)
            source_line = 'File "${PAYLOAD}\\' + str(relative) + '"'
            install.extend([f'SetOutPath "{directory}"', source_line])
            uninstall.append(f'Delete "$INSTDIR\\{relative}"')
    uninstall += ['RMDir "$INSTDIR\\docs\\offline-licenses"', 'RMDir "$INSTDIR\\docs"']
    for filename, lines in (("install.nsh", install), ("delete.nsh", uninstall)):
        (out / filename).write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "inputs.json").write_text(json.dumps(manifest, indent=2) + "\n")
    exe = out / "Clash-Verge-AI-0.1.1-windows-x64-setup.exe"
    subprocess.run([str(args.makensis.resolve()), "/INPUTCHARSET", "UTF8",
                    "/DOUTPUT=" + str(exe), "/DPAYLOAD=" + str(payload),
                    "/DFILELIST=" + str(out / "install.nsh"), "/DDELETELIST=" + str(out / "delete.nsh"),
                    str(NSIS / "offline-ai.nsi")], check=True)
    (out / "SHA256SUMS.txt").write_text(digest(exe) + "  " + exe.name + "\n", encoding="ascii")

if __name__ == "__main__":
    main()
