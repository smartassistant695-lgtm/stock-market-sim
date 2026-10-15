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
| `/` (Home) | Full-screen photo, project title, short text about the study |
| `/simulation.html` | The experiment (start screen, no code) |
| `/about.html` | About Us text |
| `/market.html` | Live stock charts for visitors |
| `/options.html` | Options Playground: a pretend-money calculator for call and put options (not part of the study) |
| `/contact.html` | Contact form; messages go to the **Contact** tab of the Google Sheet |
| `/researcher.html` | Researcher only (small link in the footer, needs the researcher code): version, sending status, CSV downloads |
| `/builder.html` | Researcher only: builds the real experiment data from Alpaca |
| `/test.html` | Connection test (Stage 0) |

## Files you edit

| What | File | Look for |
|---|---|---|
| Home photo | `public/images/hero.jpg` (NYSE photo by Jamal Eid, used with permission) | see `public/images/README.txt` |
| Photo credit, project title, the small label above it, the study text | `public/index.html` | `EDIT PHOTO CREDIT`, `EDIT PROJECT TITLE`, `EDIT LABEL`, `EDIT STUDY TEXT` |
| Footer: names, school, email, photo credit | `public/js/footer.js` | `EDIT THE FOOTER TEXT HERE` |
| About Us text | `public/about.html` | `PASTE YOUR ABOUT US TEXT HERE` |
| Consent text | `public/simulation.html` | `EDIT CONSENT TEXT BELOW` |
| Names on the thank-you screen (who removes answers) | `public/simulation.html` | `EDIT THE NAMES BELOW` |
| Timing, cash, number of checkpoints, stop loss / take profit steps | `public/js/config.js` | comments next to each number |
| Link to your Google Form survey | `public/js/config.js` | `SURVEY_URL` (see "Connect your Google Form" below) |

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

**If Apps Script won't open or gives an error**, the usual cause is being
signed in to your school and personal accounts at the same time: Apps Script
then opens with the wrong one. Fixes, easiest first:
- Do all of Step 1 in a **private / incognito window** where you sign in with
  only your personal account.
- Or go to <https://script.google.com> (signed in as your personal account),
  click **New project**, and paste the code there. Then set `SHEET_ID` at the
  top of the code to your sheet's ID: the long part of the sheet's address
  between `/d/` and `/edit`.
- School-managed computers and Chromebooks may block personal accounts
  completely. Use a home computer or a parent's computer.

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
7. About a minute later the "Placeholder data" warning on the Researcher
   page and the red "Practice data" line on the simulation start screen
   disappear.

Until you do this, the experiment runs on made-up placeholder prices so you can
try it out.

## Step 4. Connect your Google Form (optional)

At the end, the thank-you screen can show a button **Continue to the short
survey** that opens your Google Form with the participant's code already
filled in. Without a link there is no button.

1. In Google Forms, add a **Short answer** question called `Participant code`.
2. Click **More** (the three dots at the top right) **> Get pre-filled link**.
3. Type `PARTICIPANT_CODE` in the "Participant code" question.
4. Click **Get link**, then **Copy link**.
5. Open `public/js/config.js`, find `SURVEY_URL: ''`, and paste the link
   between the quotes, for example
   `SURVEY_URL: 'https://docs.google.com/forms/d/e/.../viewform?usp=pp_url&entry.123456=PARTICIPANT_CODE',`.
   Commit the change.

The site replaces `PARTICIPANT_CODE` with each participant's code (for example
`P-7F3K`), so the form answers and the trading data can be matched. The form
opens in the same tab; when the participant is done, open `/simulation.html`
again for the next participant.

## Before real data collection

The data columns changed (stop loss, take profit and Directions columns were
added at the end). Google Sheets adds new column names to the end of an old
header row, so before your first real participant **delete the old test tabs
`Actions`, `Summary` and `Sessions`** in the Google Sheet (right-click the tab
> Delete). They are made again, with the right header row, by the next saved
row. Keep the `_batches` tab or delete it too; both are fine.

## Step 5. Running a participant

1. Turn the iPad to landscape and open `/simulation.html`. Under the
   **Begin** button, check that the line says "All results uploaded." and that
   there is no red line.
2. To check or choose the version, open the **Researcher** page (the small
   link at the bottom of the page) and enter the researcher code. The version
   rotates automatically 1 > 2 > 3 > 4; you can choose one by hand there. The
   Researcher page locks again when the next session starts, so you enter the
   code again the next time you open it.
3. Go back to `/simulation.html`, tap **Begin** and hand the iPad to the
   participant. There is no participant number to type: the iPad gives each
   participant an anonymous code such as `P-7F3K`. For the strongest
   lockdown, turn on Guided Access (Settings > Accessibility > Guided Access,
   then triple-click the top button) or open the site from a Home Screen icon
   (Share > Add to Home Screen).
4. The participant reads the consent form, the instructions and a short
   "Reading the chart" lesson, trades a practice stock, then four stocks (the
   chart stops 4 times per stock; a **Directions** button shows the
   instructions again at any time; a stop loss or take profit is optional),
   and rates each stock.
5. The thank-you screen shows their participant code ("If you ever want your
   answers removed, give this code to Noah or Jojo.") and, if you connected
   a Google Form, the survey button. Press and hold the **top-left corner** of
   the screen for 3 seconds (no code). The page goes back to the start screen,
   ready for the next participant. The same hold in the middle of a session
   asks "End this session?". If the participant went on to the survey, just
   open `/simulation.html` again afterwards.
6. If the page is closed or refreshed by accident, open `/simulation.html`
   again. It shows **Continue where you left off**.

**Getting the data.** Rows appear in your Google Sheet after every stock, in
the tabs **Actions**, **Summary** and **Sessions**. The iPad also keeps a
backup copy: the Researcher page has **Actions CSV / Summary CSV / Sessions
CSV** buttons that save files to the iPad's Files app (Downloads folder). If a
send fails, the start screen says how many results are waiting, the
Researcher page shows a red warning with the error and **Retry sending now**,
and the iPad keeps retrying on its own. No code is needed to take part, so
anyone who opens the site can add rows: use the times of your sessions and the
`device` column to find your participants' rows; the participant code links
one person's rows and their survey answers (`docs/EXPERIMENT.md`, section 7).
To remove someone's answers, delete the rows with their code in every tab
(and in the form responses).

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
