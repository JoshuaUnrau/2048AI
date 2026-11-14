# PadForge phone apps (Android and iPhone)

The apps show the same controller as the browser version and add three things a web page can't do:

| | Android app | iPhone app | Browser |
|---|---|---|---|
| **Volume buttons as controller inputs** | ✅ Real press and release | ✅ Press detected; release ≈0.45 s after the last repeat (see below) | ❌ |
| Motion controls without a certificate warning | ✅ | ✅ | needs the https link |
| Vibration for haptics and game rumble | ✅ | ✅ (Taptic Engine) | Android only |

The apps connect to the bridge's plain address (`http://<PC>:8080`). They read the motion sensors themselves, so HTTPS isn't needed.

## Android

1. On the GitHub repository, open **Actions → PadForge**, choose the latest run, and download the **PadForge-android** artifact. Unzip it to get `app-release.apk`.
2. Copy the APK to the phone and open it. Allow "install unknown apps" for your file manager or browser when Android asks.
3. Open **PadForge**. Enter the **address** and **pairing code** shown by the bridge on the line `PadForge phone app: address … code …`, then tap **Connect**.
4. While the controller is on screen:
   - **Volume up and down go to the controller.**
   - **Back** returns to the connection screen, where the volume buttons work normally again.
   - **⚙** (top right) also returns to the connection screen.

To build it yourself, use Android Studio: open `padforge/native/android`, then run. Or, with Gradle 8.7+ and JDK 17, run `gradle assembleRelease`.

## iPhone

Installing on an iPhone needs a Mac with Xcode. A free Apple ID works; apps installed that way must be re-installed every 7 days, and a paid developer account removes that limit.

```bash
brew install xcodegen
cd padforge/native/ios
xcodegen            # creates PadForge.xcodeproj
open PadForge.xcodeproj
```

In Xcode:
1. Select the **PadForge** target, go to **Signing & Capabilities**, and choose your **Team** (your Apple ID).
2. If Xcode says the bundle id is taken, change it to something unique.
3. Plug in the iPhone, select it as the run destination, and press **Run**.
4. On the phone:
   - **Settings → General → VPN & Device Management** → trust your developer certificate.
   - **Settings → Privacy & Security → Developer Mode** → turn it on (iOS 16+).
5. Open PadForge, allow **Local Network** access when asked, and enter the address and pairing code.

### How the iPhone volume buttons work
iOS has no "button pressed" event for apps. PadForge watches the system volume instead:
- Each press nudges the volume. PadForge reports which button it was, then puts the volume back.
- A hidden volume control stops the volume overlay from appearing.
- iOS doesn't report releases either, so holding a button works through iOS's auto-repeat. The button counts as held until the repeats stop, which means firing continues about **0.45 s** after you let go. This is set by `releaseDelay` in `native/ios/PadForge/VolumeButtons.swift`.
- The phone's own volume ends up at 50%. This doesn't matter for game audio, which plays on the PC.

**App Store note:** Apple's guidelines don't allow apps to change what the volume buttons do (App Store Review Guideline 2.5.9). The iPhone app is fine to install yourself through Xcode (or TestFlight for friends), but would likely be rejected from the public App Store. Android has no such restriction.
