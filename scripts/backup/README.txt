AGSIST MONTHLY BACKUP
=====================

What this folder does
---------------------
Double-click backup-agsist once a month. It saves, onto this drive:

  repos\   a full copy of each GitHub repo: feedbag, agsist, bids, flashgrain
           (every branch, every commit).
  kv\      kv-YYYY-MM-DD.json: every record the subs worker keeps
           (the subscriber list, alerts, Rain Print orders, gift cards,
           elevator listings). The newest 12 are kept.
  log\     backup-YYYY-MM-DD.txt: what ran and how many, counts only.

The last line in the window says how it went, for example:
  Backup done: 4 repos up to date, 3,418 records saved, Nov 1 2026.
If something fails, that line says what failed and what to do.

KEEP THIS DRIVE SAFE. The kv files hold every subscriber's email address
and the order records. Do not leave it plugged into a shared PC, do not
copy the kv folder to email or a cloud drive.


First time (about 10 minutes)
-----------------------------
1. Install Git for Windows: https://git-scm.com/download/win
   Run the installer and keep every default choice. That also installs
   Git Credential Manager, which does the GitHub login.
2. Copy this whole folder (backup-agsist.cmd, backup-agsist.ps1, this
   README.txt) to the SSD, for example E:\agsist-backup\
3. Double-click backup-agsist.cmd.
4. A browser window opens for GitHub. Sign in as dnilgis and allow it.
   This happens the first time only; Windows remembers the login.
   The first copy of the repos can take a while.
5. It asks for LIST_TOKEN. Copy it from Cloudflare (Workers and Pages,
   agsist-api, Settings, Variables and Secrets) or wherever you keep it,
   paste it (right-click pastes in the window; the typing stays hidden)
   and press Enter. It is saved in list-token.dpapi in this folder, locked
   to your Windows user on this PC. Nobody else can read it, and it does
   not work on another PC.
6. Wait for the last line, then press any key to close the window.


Every month
-----------
Plug in the SSD, open the folder, double-click backup-agsist.cmd, wait for
"Backup done", press any key. The morning email reminds you on the 1st.

If it says the token was refused: LIST_TOKEN was changed. Double-click
again and paste the new one. If you use a different PC, it asks for the
token once on that PC too.


How to restore
--------------
A repo (if GitHub lost it, or for a fresh copy on a new PC):
  Open "Git Bash" from the Start menu and run, for example:
    git clone E:/agsist-backup/repos/agsist.git agsist
  That gives a normal working copy of every branch and commit. To put it
  back on GitHub, create the empty repo on github.com, then from inside
  E:/agsist-backup/repos/agsist.git run:
    git push --mirror https://github.com/dnilgis/agsist.git

The subscriber list and orders (if the worker's store was lost):
  The newest kv\kv-YYYY-MM-DD.json is the whole store as of that day.
  Each record has its name, its value (or value_b64 for an image), and
  its metadata and expiration where it had them. Do not edit the file.
  Ask Claude to load it back into the worker's KV store; it is read
  record by record and written back with the same names and values.
