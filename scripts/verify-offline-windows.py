"""Verify the final installer and its embedded uninstaller against the build inputs."""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEBVIEW = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def extract(sevenzip, archive, directory):
    subprocess.run([str(sevenzip), "x", "-y", "-o" + str(directory), "--", str(archive)],
                   check=True, stdout=subprocess.DEVNULL)
    return {p.relative_to(directory).as_posix(): digest(p) for p in directory.rglob("*") if p.is_file()}

def compare(actual, expected):
    if actual != expected:
        bad = [p for p in actual.keys() | expected.keys() if actual.get(p) != expected.get(p)]
        raise ValueError("Unexpected, missing or changed installer files: " + ", ".join(sorted(bad)))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("build", "nsis", "sevenzip"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    archive = args.build / "Clash-Verge-AI-0.1.1-windows-x64-setup.exe"
    sha, name = (args.build / "SHA256SUMS.txt").read_text().split()
    if name != archive.name or sha != digest(archive):
        raise ValueError("Installer SHA-256 mismatch")
    expected = json.loads((args.build / "inputs.json").read_text())
    expected["$PLUGINSDIR/" + WEBVIEW] = expected.pop(WEBVIEW)
    helpers = {"$PLUGINSDIR/check-install.ps1": digest(ROOT / "src-tauri/packages/windows/check-ai-install.ps1")}
    for dll in ("System.dll", "nsExec.dll"):
        helpers["$PLUGINSDIR/" + dll] = digest(args.nsis / "Plugins/x86-unicode" / dll)
    expected.update(helpers)
    expected["$PLUGINSDIR/nsDialogs.dll"] = digest(args.nsis / "Plugins/x86-unicode/nsDialogs.dll")
    expected["$PLUGINSDIR/modern-wizard.bmp"] = digest(args.nsis / "Contrib/Graphics/Wizard/win.bmp")
    with tempfile.TemporaryDirectory() as temp:
        outer = Path(temp) / "installer"
        actual = extract(args.sevenzip, archive, outer)
        if not actual.pop("Uninstall.exe", None):
            raise ValueError("Missing uninstaller")
        compare(actual, expected)
        compare(extract(args.sevenzip, outer / "Uninstall.exe", Path(temp) / "uninstaller"), helpers)
    print(f"Verified {len(expected) + 1} installer entries and {len(helpers)} uninstaller entries.")

if __name__ == "__main__":
    main()
