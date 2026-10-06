# Skysailing work vehicles: Garage + Sky Sailing + Tractors

A free, phone-first maintenance site for Blue's vehicles, gliders and tractors.
Plain HTML/CSS/JS with no build step, no paid services and no API keys. GitHub Pages hosts it for free.

> **Everything in this repo is PUBLIC.** Never put a VIN, license plate, N-number, serial number, address or customer info in normal fields.
> The site blocks VIN-looking text there and asks before saving N-number-looking text. Sensitive details go in each profile's encrypted **Vault** (below).

## Turn it on (one time)
1. Push these files to `skyking211/garage` (branch `main`, repo root).
2. On GitHub, go to **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**, then Save.
3. After about a minute the site is live at https://skyking211.github.io/garage/

## Editing from your phone (no code)
- Open a vehicle or glider and use **+ Log service**, **+ Add part**, **Update mileage / total time**, the to-do checkboxes, **Change photo**, or **+ Add vehicle / + Add aircraft** on the home tabs.
- **Without a token**, edits save on that phone only. The pill at the top reads **Not synced**. Use **Settings → Export JSON** to back up and **Import JSON** to restore.
- **With a token**, every edit is committed to `data/garage.json` in this repo. Photos are shrunk on the phone to 1280 px and committed to `images/`. The public site updates after GitHub Pages rebuilds, usually within 1–2 minutes.

### Make the token (about 2 minutes)
1. Go to GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** (https://github.com/settings/personal-access-tokens/new).
2. Name it `garage site` and pick an expiration.
3. **Repository access:** *Only select repositories* → `skyking211/garage`.
4. **Repository permissions → Contents:** *Read and write*. Leave everything else as is.
5. Generate the token, copy it (`github_pat_…`), open the site's **⚙ Settings**, paste it, tap **Save**, then tap **Test**.

The token lives **only in that browser's localStorage**. It is never committed. Repeat the steps on each device you edit from. To revoke it, delete the token on GitHub.

If two devices edit at once, the site detects the conflict and asks you to **Merge both** (recommended), **Keep mine**, **Use GitHub's**, or **Not now**.

## Tractors
The **Tractors** tab (`#/tractors`, Ford-yellow theme) holds machines that run on an engine **hour meter**, so the schedule, log and meter forms use **Hours** instead of miles.
- Ford 445C tractor loader / backhoe. The year (1990) is decoded from the ID plate's unit code. The specs, schedule and parts each list a source. Anything that couldn't be confirmed is labelled *unverified*, *uncertain* or *part # needed*, or left blank as "add".
- Keith's Tractor: a Satoh S-650G (from its plate). Specs and most intervals come from the factory S-650G Instruction Book (scanned copy) and TractorData.
- Lil Red: a vintage Ford. The model shown is an estimate from the engine block casting (EAE-6015-D, a part number, not a serial). Model and year stay "add" until confirmed.
- For the 445C, most maintenance intervals are marked "interval not verified". Check operator's manual 42034530 (Section D, Lubrication & Maintenance) and fill them in.
- The tractor number, engine serial and PIN go only in the tractor's **Vault**, never in normal fields.

## Vault (encrypted details)
Each vehicle, aircraft and tractor profile has a **Vault** card for the plate, VIN, N-number, serial numbers, PIN, registration, insurance and similar details.

**How it works**
- The first time, you set a vault password. By default one password covers the whole site; you can switch to one password per vault in Settings.
- When you tap Save, your phone encrypts the details before anything is stored. It uses the browser's built-in WebCrypto:
  - PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt per vault turns the password into a key.
  - AES-GCM-256 encrypts with a fresh random 12-byte IV on every save.
- Only the scrambled result goes into `data/garage.json`, as `vault: {v, kdf, iter, salt, iv, ct}`. It then syncs like any other edit (or stays "not synced" on the device). Export JSON contains only that encrypted blob.
- The password is never stored: not in the repo, not in localStorage or sessionStorage, and no hash of it either. The decrypted details exist only in the page's memory while the vault is unlocked. In one-password mode the password is also held in memory while unlocked, so the other vaults open too. Locking clears it.
- The vault locks when you tap **Lock**, after 5 minutes idle, or when you switch away from the page. Unsaved vault edits are encrypted and saved first.
- Search, the request form and the console never see vault contents. VIN and N-number values are allowed inside the vault because they are encrypted.

**Honest limits**
- The encrypted data is **public**. Anyone can download it and try to guess the password offline, as fast as their computers allow. With a long password (12+ characters, or a passphrase of 4+ random words) that's practically hopeless. With a short or common password it may not be. Use a long one.
- **Nobody can recover a lost password.** Not you, not GitHub, not whoever built the site. If it's lost, use "Forgot the password?" to erase the vault and type the details in again.
- Encryption protects data at rest. It can't protect an unlocked vault on a phone someone else is holding, a phone with malware, or text you copied to the clipboard.
- Changing the password re-encrypts the vaults. Older copies in the Git history stay encrypted with the old password, so if you change it because the old one leaked, assume those old copies are readable.

## Request form
Requests go through FormSubmit (free, no account) to the shop Gmail.
**The first request sends a one-time activation email to that inbox.** Click "Activate Form" in it; until you do, requests don't arrive.
Note: the destination email is visible in the page source. FormSubmit can swap it for a random alias string after activation if you prefer.

## Files
- `index.html`: the whole app (hash routes: `#/`, `#/sky`, `#/tractors`, `#/v/<id>`, `#/request/<id>`, `#/settings`, `#/search/<q>`)
- `data/garage.json`: all data. Each item has `category: "vehicle"`, `"aircraft"` or `"tractor"`. Tractors use `hours` + `meterDate`.
- `js/store.js`: load/save and GitHub sync · `js/vault.js`: encrypted Vault · `js/schedule.js`: due/overdue math · `js/turntable.js`: drag-to-spin viewer · `js/app.js`: UI
- `thanks.html`: page shown after a request is sent

## Credits
- Enclave photos: "2022 Buick Enclave Premium AWD in Quicksilver Metallic" (front left and rear right) by **Elise240SX**, **CC BY-SA 4.0**, via Wikimedia Commons.
  Background removed, resized and mirrored for the turntable; those derivatives are shared under CC BY-SA 4.0.
- Owl (the SGS 1-26E) photo, `images/sgs-126/`: the owner's own photo. Resized, with all EXIF/GPS metadata removed.
- Ford 445C photo, `images/ford-445c/`: the owner's own photo. Cropped and resized, with all EXIF/GPS metadata removed.
- Glider fallback artwork (`images/glider.svg`): original stylized SVG made for this site.
- Keith's Tractor photo (`images/keiths-tractor/`) and Lil Red photo (`images/lil-red/`): the owner's own photos. Cropped and resized, with all EXIF/GPS metadata removed.
- Tractor fallback artwork (`images/tractor.svg`): original SVG made for this site.
- Fonts: Big Shoulders Display, Inter, JetBrains Mono (SIL Open Font License) via Google Fonts.
- Maintenance intervals come from the 2022 Buick Enclave Owner's Manual. Aircraft items come from 14 CFR 91.409 and FAA ADs 87-02-01 / 87-17-01. Satoh S-650G items come from the factory Instruction Book and TractorData. Ford 445C items come from TractorData, quotes from operator's manual 42034530, WIX application lookups and parts-seller fitment lists. Each profile lists its sources.
