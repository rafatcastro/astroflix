# Astroflix

## Building (macOS)

Requirements: Node >= 22.5, pnpm and the Rust toolchain. ffmpeg is optional (covers, durations
and video conversion).

```bash
brew install node pnpm rustup ffmpeg
echo 'export PATH="$(brew --prefix rustup)/bin:$PATH"' >> ~/.zshrc   # rustup is keg-only
source ~/.zshrc
rustup default stable

pnpm install
pnpm dev             # development: Tauri window over Vite + server, with hot reload
pnpm desktop:build   # installer for this machine
```

`pnpm desktop:build` writes the app and the installer to `desktop/src-tauri/target/release/bundle/`:

- `macos/Astroflix.app`
- `dmg/Astroflix_<version>_<arch>.dmg`

At the end it signs the updater package. Without `TAURI_SIGNING_PRIVATE_KEY` set, that step fails
with "A public key has been found, but no private key" and the command exits with an error, but the
`.app` and the `.dmg` are already complete and work. Only the auto-updater needs the key, and the
releases come from CI (`.github/workflows/release.yml`). The local build is not notarized: if you
copy the `.dmg` to another Mac, macOS blocks it on first open until it is allowed in System
Settings → Privacy & Security → Open Anyway.

## Credits

Astroflix is a fork of **[Learnflix v2](https://github.com/OnaitsirC-MiromA/learnflix-v2)**, created by
[OnaitsirC-MiromA](https://github.com/OnaitsirC-MiromA). All credit for the original app goes to that
project; this repository holds the changes built on top of it.

Distributed under the MIT License. The original copyright notice is kept in [LICENSE](LICENSE).
