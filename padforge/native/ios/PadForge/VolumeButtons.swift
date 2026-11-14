import AVFoundation
import MediaPlayer
import UIKit

/// Turns the iPhone's volume buttons into controller inputs.
///
/// iOS has no public "volume button pressed" event, so this watches the system
/// output volume: each press nudges it, we report which button it was, then put
/// the volume back to the middle so the next press is always detectable. A hidden
/// MPVolumeView keeps the system volume overlay from appearing.
///
/// iOS doesn't report releases either. Holding a volume button makes iOS repeat
/// the change, so a button counts as held until no change has arrived for
/// `releaseDelay` seconds.
final class VolumeButtons: NSObject {
    /// (key, isDown) with key "AudioVolumeUp" or "AudioVolumeDown".
    var onChange: ((String, Bool) -> Void)?
    var releaseDelay: TimeInterval = 0.45

    private let session = AVAudioSession.sharedInstance()
    private let volumeView = MPVolumeView(frame: CGRect(x: -3000, y: -3000, width: 1, height: 1))
    private var observation: NSKeyValueObservation?
    private var resettingTo: Float?
    private var resetDeadline = Date.distantPast
    private var releaseTimers: [String: Timer] = [:]
    private let middle: Float = 0.5
    private(set) var enabled = false

    func install(in view: UIView) {
        volumeView.alpha = 0.01
        volumeView.isUserInteractionEnabled = false
        view.addSubview(volumeView)
        activateSession()
        observation = session.observe(\.outputVolume, options: [.old, .new]) { [weak self] _, change in
            guard let old = change.oldValue, let new = change.newValue else { return }
            DispatchQueue.main.async { self?.volumeChanged(from: old, to: new) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// Only capture the buttons while the controller is on screen.
    func setEnabled(_ on: Bool) {
        enabled = on
        volumeView.isHidden = !on // visible (off-screen) view = system volume overlay suppressed
        if on { setVolume(middle) } else { releaseAll() }
    }

    func releaseAll() {
        for (key, timer) in releaseTimers {
            timer.invalidate()
            onChange?(key, false)
        }
        releaseTimers.removeAll()
    }

    @objc private func appBecameActive() {
        activateSession()
        if enabled { setVolume(middle) }
    }

    private func activateSession() {
        // Ambient + mix: doesn't interrupt other audio, but lets us observe the volume.
        try? session.setCategory(.ambient, options: [.mixWithOthers])
        try? session.setActive(true)
    }

    private func volumeChanged(from old: Float, to new: Float) {
        if let target = resettingTo {
            if abs(new - target) < 0.001 || Date() > resetDeadline { resettingTo = nil }
            if abs(new - target) < 0.001 { return }
        }
        guard enabled, abs(new - old) > 0.0001 else { return }
        press(new > old ? "AudioVolumeUp" : "AudioVolumeDown")
        // Re-centre so repeated presses never hit the 0% / 100% limits.
        setVolume(middle)
    }

    private func press(_ key: String) {
        if releaseTimers[key] == nil { onChange?(key, true) }
        releaseTimers[key]?.invalidate()
        releaseTimers[key] = Timer.scheduledTimer(withTimeInterval: releaseDelay, repeats: false) { [weak self] _ in
            self?.releaseTimers[key] = nil
            self?.onChange?(key, false)
        }
    }

    private func setVolume(_ value: Float) {
        if abs(session.outputVolume - value) < 0.001 { return }
        resettingTo = value
        resetDeadline = Date().addingTimeInterval(0.5)
        // MPVolumeView's slider is the only supported way for an app to set the volume.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { [weak self] in
            guard let slider = self?.volumeView.subviews.compactMap({ $0 as? UISlider }).first else { return }
            slider.setValue(value, animated: false)
            slider.sendActions(for: .valueChanged)
        }
    }
}
