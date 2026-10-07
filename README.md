# Stock Chart Study

A psychology experiment that tests whether a stock chart's candle timeframe
(1-minute, 5-minute, 10-minute or 1-hour) changes trading behavior and how
volatile the stock feels. Built for iPad Safari in landscape orientation.

The site is plain HTML, CSS and JavaScript (no build step), hosted on
**Vercel**, with small serverless functions in `api/`. Data is saved to a
Google Sheet through a Google Apps Script web app.

## How data gets saved

```
iPad (Safari)  -->  your-site.vercel.app/api/save  -->  Google Apps Script  -->  Google Sheet
```

The iPad only ever talks to your own site's address. The school network
therefore only needs to allow `*.vercel.app`, and the Google Script URL and
API key stay hidden on the server.

## Files

| File | What it is |
|---|---|
| `public/` | Everything the browser loads (pages, styles, scripts) |
| `public/test.html`, `public/js/test.js` | Stage 0 connection test page |
| `public/css/style.css` | Shared styles (colors are set at the top) |
| `api/save.js` | Serverless function that forwards data to Google Sheets |
| `google-apps-script/Code.gs` | Code you paste into Google Apps Script |
| `vercel.json` | Tells Vercel to serve the `public/` folder |
| `.env.example` | List of secret settings. Copy it to `.env` for local scripts. `.env` is never committed. |

## Build plan

| Stage | What gets built | What you test |
|---|---|---|
| 0 | Hosting + Google Sheets test page | Site opens and saves a row on the school iPad and Wi-Fi |
| 1 | Download script for 4 stocks x 3 days of 1-minute data, aggregated to 5m/10m/1h, rescaled and renamed, saved as a data file | Volatility report, data file looks right |
| 2 + 3 | Site tabs, experiment flow, Latin square, trading logic, bundled Lightweight Charts | Run the whole experiment on a laptop |
| 4 | iPad polish: landscape lock, no zoom/scroll, numeric keypad, resume after refresh | Run it on the iPad |
| 5 | Logging every action to Sheets after each stock, retries, local backup, CSV download, failure warning | Turn Wi-Fi off mid-session and check nothing is lost |
| 6 | Market Data tab with live charts through the serverless function | Look up a few tickers |

---

## Stage 0: hosting test (what you need to do)

Each step says exactly where to click. It takes about 20 minutes.

### Step 1. Create the Google Sheet and Apps Script

Use a **personal Google account**, not your school account. School Google
accounts often stop scripts from being shared with "Anyone", and the site
needs that setting to work.

1. Go to <https://sheets.google.com> and create a blank spreadsheet. Name it
   `Stock Chart Study Data`.
2. In the sheet, open **Extensions > Apps Script**. A new tab opens with a
   file called `Code.gs`.
3. Delete everything in `Code.gs`. Paste in the whole contents of
   `google-apps-script/Code.gs` from this project.
4. Click the save icon (or press Cmd+S). Name the project `Stock Chart Study`
   if it asks.

### Step 2. Deploy the Apps Script as a web app

1. In Apps Script, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**, then **Authorize access** and choose your Google account.
5. Google shows a warning: "Google hasn't verified this app". This is normal
   for a script you wrote yourself. Click **Advanced**, then
   **Go to Stock Chart Study (unsafe)**, then **Allow**.
6. Copy the **Web app URL**. It ends in `/exec`. Keep it somewhere private.
   Anyone with this URL can add rows to your sheet.
7. Check it: paste the URL into a new browser tab. You should see
   `{"ok":true,"message":"Apps Script is running"}`.

**If you change `Code.gs` later**, keep the same URL by redeploying this way:
**Deploy > Manage deployments >** pencil icon **> Version: New version > Deploy**.
If you click "New deployment" instead, you get a new URL.

### Step 3. Create a Vercel account

1. Go to <https://vercel.com/signup>.
2. Choose **Hobby** (free, for personal and non-commercial projects). Enter
   your name.
3. Click **Continue with GitHub** and sign in with the GitHub account that owns
   this repository.

### Step 4. Import this project into Vercel

1. In the Vercel dashboard, click **Add New... > Project**.
2. Find `stock-market-sim` in the list and click **Import**. If it isn't
   listed, click **Adjust GitHub App Permissions** and give Vercel access to
   the repository.
3. On the "Configure Project" screen:
   - Framework Preset: **Other**
   - Root Directory: leave as `./`
   - Build and Output Settings: leave as they are (`vercel.json` handles this)
4. Open **Environment Variables** and add one:
   - Key: `SHEETS_URL`
   - Value: the `/exec` URL from Step 2
5. Click **Deploy**. After about a minute you get a link like
   `https://stock-market-sim-xxxx.vercel.app`.

**Where secrets go later.** Secrets (like the Alpaca keys `ALPACA_KEY_ID` and
`ALPACA_SECRET_KEY` in Stage 1) are
entered in **Project > Settings > Environment Variables**. After you add or
change one, it only takes effect after a redeploy: **Deployments >** the "..."
menu on the newest deployment **> Redeploy**.

### Step 5. Check the production branch

The code is on the branch `claude/stock-chart-psychology-exp-8adbkf`. Vercel
only makes a public link for the **production branch**. Other branches get
"preview" links that ask for a Vercel login, and that login screen would
appear on the school iPad.

1. Go to **Project > Settings > Git** (on some versions it is under
   **Settings > Environments > Production**).
2. Make sure **Production Branch** is `claude/stock-chart-psychology-exp-8adbkf`.
   If you change it, go back to **Deployments** and redeploy.
3. Always use the main domain shown on the project's overview page
   (`https://<project-name>.vercel.app`). Don't use the long preview links.

### Step 6. Test on the school iPad

1. On the school iPad, connected to **school Wi-Fi**, open Safari. Make sure
   Private Browsing is **off**.
2. Go to `https://<your-project-name>.vercel.app/test.html`.
3. All the checks should show green:
   - Page and script loaded: **Yes**
   - Server function: **Working**
   - Google Sheets URL set in Vercel: **Yes**
   - Device storage: **Works**
4. Tap **Save test row**. It should say "Saved. Rows added: 1".
5. Open your Google Sheet. A new tab named **Test** should have your row. A
   tab called **_batches** also appears. It's used to prevent duplicate saves,
   so leave it there.

### If something fails

| What you see | What it means / what to do |
|---|---|
| The page doesn't load at all, or a school "blocked" page appears | The school filter blocks `vercel.app`. Ask IT to allow `*.vercel.app`, or tell me and we'll switch hosts. |
| Server function: **Not reachable** | Deployment problem. Check the latest deployment in Vercel finished with "Ready". |
| Google Sheets URL set: **No** | `SHEETS_URL` is missing or misspelled. Fix it in Settings > Environment Variables, then redeploy. |
| "Google did not return JSON" | In Apps Script, the web app access isn't set to **Anyone**, or the URL isn't the `/exec` one. |
| A Vercel login page appears | You opened a preview link. Use the production domain (Step 5). |
| Device storage: **Blocked** | Turn off Private Browsing. Local backups need storage. |
