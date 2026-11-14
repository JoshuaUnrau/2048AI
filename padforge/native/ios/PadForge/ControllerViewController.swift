import CoreMotion
import UIKit
import WebKit

/// Full-screen web view showing the controller served by the PadForge bridge, plus
/// what a web page can't do on its own: volume buttons as inputs, native motion
/// sensors and haptics.
final class ControllerViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private let volume = VolumeButtons()
    private let motion = CMMotionManager()
    private let haptics = UIImpactFeedbackGenerator(style: .medium)
    private var onController = false
    private let defaults = UserDefaults.standard

    // Runs in every page before its own scripts.
    private static let shim = """
    (function () {
      window.__pfNative = 'ios';
      var post = function (m) { window.webkit.messageHandlers.padforge.postMessage(m); };
      window.PadForgeNative = {
        connect: function (url) { post({ op: 'connect', url: String(url) }); },
        setup: function () { post({ op: 'setup' }); },
        vibrate: function (ms) { post({ op: 'vibrate', ms: ms }); }
      };
      navigator.vibrate = function (p) {
        var ms = Array.isArray(p) ? (p[0] || 0) : (p || 0);
        post({ op: 'vibrate', ms: Math.round(ms) });
        return true;
      };
    })();
    """

    override func loadView() {
        let content = WKUserContentController()
        content.add(WeakMessageHandler(self), name: "padforge")
        content.addUserScript(WKUserScript(source: Self.shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.05, green: 0.06, blue: 0.08, alpha: 1)
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        UIApplication.shared.isIdleTimerDisabled = true
        volume.onChange = { [weak self] key, down in
            self?.web.evaluateJavaScript("window.dispatchEvent(new KeyboardEvent('\(down ? "keydown" : "keyup")',{key:'\(key)'}))")
        }
        volume.install(in: view)
        if let saved = defaults.string(forKey: "url"), let url = URL(string: saved) {
            web.load(URLRequest(url: url))
        } else {
            showSetup(error: nil)
        }
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    // Don't let swipes from the screen edges (Control Centre, Home) trigger mid-game on the first swipe.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    private func showSetup(error: String?) {
        setControllerActive(false)
        guard let file = Bundle.main.url(forResource: "setup", withExtension: "html") else { return }
        var items = [URLQueryItem(name: "u", value: defaults.string(forKey: "url") ?? "")]
        if let error { items.append(URLQueryItem(name: "e", value: error)) }
        var comps = URLComponents()
        comps.queryItems = items
        let hash = comps.percentEncodedQuery ?? ""
        web.loadFileURL(URL(string: file.absoluteString + "#" + hash)!, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    private func setControllerActive(_ on: Bool) {
        onController = on
        volume.setEnabled(on)
        if on { startMotion() } else { motion.stopDeviceMotionUpdates() }
    }

    // MARK: motion sensors -> "pf-devicemotion" events (same shape as Safari's DeviceMotionEvent)

    private func startMotion() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 60.0
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let m = data, self.onController else { return }
            let d = 180.0 / Double.pi
            let r = m.rotationRate
            // Safari reports acceleration including gravity in m/s² with CoreMotion's signs.
            let g = 9.80665
            let ax = (m.gravity.x + m.userAcceleration.x) * g
            let ay = (m.gravity.y + m.userAcceleration.y) * g
            let az = (m.gravity.z + m.userAcceleration.z) * g
            let js = String(format: "window.dispatchEvent(Object.assign(new Event('pf-devicemotion'),{rotationRate:{alpha:%.3f,beta:%.3f,gamma:%.3f},accelerationIncludingGravity:{x:%.4f,y:%.4f,z:%.4f},interval:%.2f}))",
                            r.z * d, r.x * d, r.y * d, ax, ay, az, self.motion.deviceMotionUpdateInterval * 1000)
            self.web.evaluateJavaScript(js)
        }
    }

    // MARK: page -> app

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        switch op {
        case "connect":
            guard let s = body["url"] as? String, let url = URL(string: s), url.scheme == "http" || url.scheme == "https" else { return }
            defaults.set(s, forKey: "url")
            web.load(URLRequest(url: url))
        case "setup":
            showSetup(error: nil)
        case "vibrate":
            let ms = (body["ms"] as? NSNumber)?.doubleValue ?? 0
            if ms > 0 { haptics.impactOccurred(intensity: CGFloat(min(1.0, 0.4 + ms / 150.0))) }
        default:
            break
        }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        let isController = webView.url?.scheme == "http" || webView.url?.scheme == "https"
        setControllerActive(isController)
        if isController { haptics.prepare() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let host = URL(string: defaults.string(forKey: "url") ?? "")?.host ?? "the bridge"
        showSetup(error: "Couldn't reach \(host). Is the bridge running, and is the phone on the same Wi-Fi? (\(error.localizedDescription))")
    }
}

/// WKUserContentController keeps a strong reference to its handlers; this breaks the cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}
