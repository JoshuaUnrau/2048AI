# PadForge plan

Handoff received Nov 14, 2026 from the cloud session that built it.

## Josh's asks
| Ask | Status |
| --- | --- |
| Run the bridge on jim | Partly live: runs, tailnet-only, keyboard/mouse output works. Virtual Xbox/DS4 pad waits on ViGEmBus (To-do #175). |
| List the APK on p.unraujoshua.com | p.unraujoshua.com has no DNS record. Josh chose a tailnet-only page (Nov 19): listed on michelle's private-web index. |

## Published APK
- URL: https://michelle-thinkcentre-m910q.tail0ffed4.ts.net/padforge.apk (tailnet only), linked from that host's index page.
- File on michelle: ~/.openclaw/workspace/private-web/padforge.apk; index backup at index.html.bak-padforge.
- Source: CI run 43652672900 (commit ad8f11e), debug-signed. To update: download the PadForge-android
  artifact, scp to padforge.apk.tmp, mv into place, re-download over HTTPS and compare SHA-256.

## Open
- Real-hardware tests: phone gyro, volume buttons, vibration, Steam, War Thunder tilt ranges.
- ViGEmBus on jim (To-do #175); check it coexists with Oculus_ViGEmBus.
- Repo home: proposed moving padforge/ out of JoshuaUnrau/2048AI into its own private repo.
- Security: incident #16 (bridge was open to the LAN), fixed in ad8f11e.
