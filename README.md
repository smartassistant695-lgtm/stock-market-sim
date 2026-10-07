# Stock Chart Study

A psychology experiment that tests whether a stock chart's candle timeframe
(1-minute, 5-minute, 10-minute or 1-hour) changes trading behavior and how
volatile the stock feels. It is built for iPad Safari in landscape
orientation.

The site is plain HTML, CSS and JavaScript (no build step), hosted on
**Vercel**, with small serverless functions in `api/`. Data is saved to a
Google Sheet through a Google Apps Script web app. The full experiment design
(Latin square, timing, data columns) is in
[`docs/EXPERIMENT.md`](docs/EXPERIMENT.md).

```
iPad (Safari)  -->  your-site.vercel.app/api/...  -->  Google Apps Script / Alpaca
```

The iPad only ever talks to your own site's address. The school network only
needs to allow `*.vercel.app`, and your keys stay hidden on the server.

## Pages

| Address | What it is |
|---|---|
| `/` (Home) | Bull photo, project title, start button |
| `/simulation.html` | The experiment (needs the researcher code) |
| `/about.html` | About Us text and credits |
| `/market.html` | Live stock charts for visitors |
| `/builder.html` | Researcher only: builds the real experiment data from Alpaca |
| `/test.html` | Connection test (Stage 0) |

## Files you edit

| What | File | Look for |
|---|---|---|
| Bull photo | `public/images/charging-bull.jpg` (add this file) | see `public/images/README.txt` |
| Photo credit and project title | `public/index.html` | `EDIT PHOTO CREDIT`, `EDIT PROJECT TITLE` |
| About Us text | `public/about.html` | `EDIT ABOUT US TEXT BELOW` |
| Consent text | `public/simulation.html` | `EDIT CONSENT TEXT BELOW` |
| Timing, cash, number of checkpoints | `public/js/config.js` | comments next to each number |

To edit a file without installing anything: open it on github.com, click the
pencil icon, make the change, and click **Commit changes**. Vercel puts the
change online automatically in about a minute.

## Secret settings (Vercel > Project > Settings > Environment Variables)

| Key | Value |
|---|---|
| `SHEETS_URL` | Google Apps Script web app URL (ends in `/exec`) |
| `ALPACA_KEY_ID` | Alpaca API Key ID |
| `ALPACA_SECRET_KEY` | Alpaca Secret Key |
| `RESEARCHER_CODE` | A password you make up. Only you use it. |

After adding or changing any of these, go to **Deployments**, open the **...**
menu on the newest deployment, and click **Redeploy**. Never put these values in
a code file; this repository is public. For local scripts, copy `.env.example`
to `.env`. `.env` is ignored by git.

---

## Step 1. Google Sheet and Apps Script (personal Google account)

Use a **personal Google account**, not your school account. School accounts
only allow access "within the district", and then saving fails.

1. Go to <https://sheets.google.com> and create a blank spreadsheet named
   `Stock Chart Study Data`.
2. Click **Extensions > Apps Script**. Delete everything in `Code.gs`, paste in
   all of [`google-apps-script/Code.gs`](google-apps-script/Code.gs), and
   click the save icon.
3. Click **Deploy > New deployment**. Next to "Select type", click the gear icon
   and choose **Web app**. Set **Execute as: Me** and **Who has access:
   Anyone**, then click **Deploy**.
4. Click **Authorize access**. When you see "Google hasn't verified this app",
   click **Advanced**, then **Go to ... (unsafe)**, then **Allow**. This is
   normal for your own script.
5. Copy the **Web app URL** (second Copy button, ends in `/exec`).
6. Check it in a private or incognito window. It must show
   `{"ok":true,"message":"Apps Script is running"}`. If it shows a sign-in page,
   the access setting is wrong.
7. Put the URL in Vercel as `SHEETS_URL` and redeploy.

**If you change `Code.gs` later**, keep the same URL by redeploying this way:
**Deploy > Manage deployments >** pencil icon **> Version: New version >
Deploy**.

## Step 2. Connection test (school iPad, school Wi-Fi)

1. Open `https://<your-project>.vercel.app/test.html` in Safari. Private
   Browsing must be off.
2. All checks should be green.
3. Tap **Save test row**. A **Test** tab should appear in your sheet.

## Step 3. Real stock data (one time)

1. Get Alpaca keys at <https://alpaca.markets>. A free paper-trading account
   is enough: go to **API Keys > Generate New Keys**. The secret is shown only
   once.
2. Add `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` and `RESEARCHER_CODE` in Vercel and
   redeploy.
3. Open `https://<your-project>.vercel.app/builder.html` and enter your
   researcher code.
4. Tap **Check 1-minute history** to see how far back Alpaca's 1-minute data
   goes for your account.
5. Keep the suggested stocks or type your own, then tap **Build data file**.
   Check the volatility report, then tap **Download stocks.json**.
6. Upload the file: on github.com open this repository, go into the
   `public/data` folder, and click **Add file > Upload files**. Choose
   `stocks.json` and click **Commit changes**.
7. About a minute later the "Placeholder data" warning on the researcher
   screen disappears.

Until you do this, the experiment runs on made-up placeholder prices so you can
try it out.

## Step 4. Running a participant

1. Turn the iPad to landscape, open `/simulation.html`, and enter the
   researcher code.
2. On the researcher screen, check that the sending status has no red warning.
   The version rotates automatically 1 > 2 > 3 > 4; you can override it.
3. Tap **Start new session** and hand the iPad to the participant.
4. When they finish, press and hold the **top-left corner** of the screen for 3
   seconds and enter the code. This hidden exit also works in the middle of a
   session.
5. If the page is closed or refreshed by accident, open `/simulation.html`
   again. It offers to resume the participant where they left off.

**Getting the data.** Rows appear in your Google Sheet after every stock, in
the tabs **Actions**, **Summary** and **Sessions**. The iPad also keeps a
backup copy: the researcher screen has **Actions CSV / Summary CSV / Sessions
CSV** buttons that save files to the iPad's Files app (Downloads folder). If a
send fails, the researcher screen shows a red warning and keeps retrying.

## If something fails

| What you see | What to do |
|---|---|
| School "blocked" page | Ask IT to allow `*.vercel.app` |
| Test page: Google Sheets URL set: No | Add `SHEETS_URL`, then redeploy |
| "Google did not return JSON" | The Apps Script access isn't **Anyone**, or you used a school account |
| A Vercel login page appears | You opened a preview link. Use the main `<project>.vercel.app` address |
| Researcher code says "not set" | Add `RESEARCHER_CODE`, then redeploy |
| Market Data or Data Builder says the keys are missing | Add both Alpaca keys, then redeploy |
| Device storage: Blocked | Turn off Private Browsing |

## Credits

Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/),
Copyright (c) 2025 TradingView, Inc., Apache License 2.0 (bundled in
`public/vendor/lightweight-charts/`). Market data:
[Alpaca](https://alpaca.markets/).
