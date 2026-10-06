# Skysailing work vehicles: garage + Sky Sailing

A free, phone-first maintenance site for Blue's vehicles and gliders.
Plain HTML/CSS/JS with no build step, no paid services and no API keys. GitHub Pages hosts it for free.

> **Everything in this repo is PUBLIC.** Never enter a VIN, license plate, N-number, serial number, address or customer info.
> The site blocks VIN-looking text and asks before saving N-number-looking text.

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

## Request form
Requests go through FormSubmit (free, no account) to the shop Gmail.
**The first request sends a one-time activation email to that inbox.** Click "Activate Form" in it; until you do, requests don't arrive.
Note: the destination email is visible in the page source. FormSubmit can swap it for a random alias string after activation if you prefer.

## Files
- `index.html`: the whole app (hash routes: `#/`, `#/sky`, `#/v/<id>`, `#/request/<id>`, `#/settings`, `#/search/<q>`)
- `data/garage.json`: all data. Each item has `category: "vehicle"` or `"aircraft"`.
- `js/store.js`: load/save and GitHub sync · `js/schedule.js`: due/overdue math · `js/turntable.js`: drag-to-spin viewer · `js/app.js`: UI
- `thanks.html`: page shown after a request is sent

## Credits
- Enclave photos: "2022 Buick Enclave Premium AWD in Quicksilver Metallic" (front left and rear right) by **Elise240SX**, **CC BY-SA 4.0**, via Wikimedia Commons.
  Background removed, resized and mirrored for the turntable; those derivatives are shared under CC BY-SA 4.0.
- Glider artwork (`images/glider.svg`): original stylized SVG made for this site.
- Fonts: Big Shoulders Display, Inter, JetBrains Mono (SIL Open Font License) via Google Fonts.
- Maintenance intervals come from the 2022 Buick Enclave Owner's Manual. Aircraft items come from 14 CFR 91.409 and FAA ADs 87-02-01 / 87-17-01. Each profile lists its sources.
