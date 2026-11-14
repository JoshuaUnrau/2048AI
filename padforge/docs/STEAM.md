# Setting up PadForge for Steam

Your phone and the PC or Deck must be on the **same Wi-Fi / LAN**. For the lowest latency, use 5 GHz Wi-Fi, or put the PC on Ethernet.

## Windows

1. Install **ViGEmBus** (the virtual controller driver): https://github.com/nefarius/ViGEmBus/releases, then reboot.
2. Install **Node.js 18 or newer**: https://nodejs.org.
3. Double-click `bridge/scripts/start-windows.bat`. The first run installs dependencies. If Windows Firewall asks, allow Node.js on **private networks**.
4. Scan the QR code with your phone, or type the printed `https://…` link.
   - The phone will warn that the certificate isn't trusted. That's expected: the bridge made its own certificate so phones are allowed to use motion sensors. Choose **Advanced → Proceed** (Android) or **Show Details → visit this website** (iPhone).
5. Tap **Start**. Steam now shows an **Xbox 360 Controller**.

### Using Steam Input
- **Steam → Settings → Controller:** turn on Steam Input for Xbox controllers if you want to remap in Steam, or use per-game Steam layouts on top of PadForge.
- **For Steam's own gyro features:** run `start-windows.bat ds4` so you get a **DualShock 4**, and turn on **PlayStation controller support** in Steam. In the PadForge editor, go to **Motion** and set **Motion controls** to *Raw gyro to DS4*, then configure gyro in Steam Input. *(Experimental: ViGEm's DS4 motion support is marked experimental upstream.)*
- **Games without controller support:** use the *Keyboard & mouse* layout. Keys are sent as hardware scan codes, so most games accept them.

## Steam Deck (and other Linux PCs)

1. Switch to **Desktop Mode** (Steam button → Power → Switch to Desktop).
2. Get this folder onto the Deck, for example with `git clone`, or by downloading the repository ZIP.
3. Open **Konsole** in the `padforge/bridge` folder and run:
   ```bash
   bash scripts/install-steamdeck.sh
   ```
   The script:
   - downloads Node.js into your home folder;
   - installs dependencies;
   - makes sure you can create virtual controllers (it may ask for your sudo password; set one with `passwd` if you never have);
   - installs a background service that also runs in **Game Mode**.
4. It prints the pairing code and the link for your phone. To see them again later:
   ```bash
   journalctl --user -u padforge -n 40
   ```
5. Return to Game Mode. Each phone shows up as an extra **Xbox 360 controller**.

**Notes for the Deck**
- The Deck's built-in controls stay player 1, so a phone is naturally **player 2**, which is good for couch co-op. To control a single-player game from the phone, reorder controllers in the Quick Access menu → **Controller settings**, or just use both at once.
- Steam Input works on the phone's pad like on any Xbox controller, so per-game Steam layouts apply.
- Automatic layout switching per game doesn't work in Game Mode yet, so pick the layout on the phone with **☰**.
- To stop or start the service:
  ```bash
  systemctl --user stop padforge
  systemctl --user start padforge
  ```

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't load the page | Same Wi-Fi? Try the `http://…:8080` link. Check the firewall (Windows: allow Node.js on private networks). Some guest or "client isolation" Wi-Fi blocks devices from seeing each other. |
| "Wrong pairing code" | Open the link the bridge printed (it contains the code), or type the code shown in the bridge window. |
| Motion controls don't respond | Use the **https** link and accept the warning. On iPhone, allow "Motion & Orientation" when asked after tapping Start. In the editor's **Motion** tab, check that motion is enabled and allowed on the current screen. |
| Bridge says "log only" | Windows: install ViGEmBus and reboot. Linux: re-run the installer, then log out and back in. |
| Inputs stop briefly | If the phone loses connection for over 1 second, the bridge releases every button so nothing stays stuck. Input resumes automatically on reconnect. |
