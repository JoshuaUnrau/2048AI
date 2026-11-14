// Motion controls: turns the phone's gyroscope into camera / mouse / steering input.
// Rotation is accumulated between frames so aiming doesn't depend on frame rate.

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Gyro {
  constructor() {
    this.supported = 'DeviceMotionEvent' in window;
    this.running = false;
    this.accX = 0; // accumulated look degrees since last read
    this.accY = 0;
    this.rate = { x: 0, y: 0 }; // last processed look rate, deg/s
    this.raw = null; // { p, y, r } deg/s in controller space (DS4 passthrough)
    this.gravity = null; // unit "up" vector in device space
    this.accelG = null;
    this.history = [];
    this.lastT = 0;
    this.cfg = null;
    this._onMotion = (e) => this._motion(e);
  }

  // iOS needs this to be called from a tap.
  async requestPermission() {
    if (!this.supported) return false;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try { return (await DeviceMotionEvent.requestPermission()) === 'granted'; } catch { return false; }
    }
    return true;
  }

  start() {
    if (this.running || !this.supported) return;
    window.addEventListener('devicemotion', this._onMotion);
    this.running = true;
  }

  stop() {
    window.removeEventListener('devicemotion', this._onMotion);
    this.running = false;
  }

  configure(cfg) { this.cfg = cfg; }

  _screenAxes() {
    let angle = screen.orientation ? screen.orientation.angle : (window.orientation || 0);
    angle = ((angle % 360) + 360) % 360;
    // Screen right / up directions expressed in device coordinates.
    switch (angle) {
      case 90: return { right: [0, -1, 0], up: [1, 0, 0] };
      case 180: return { right: [-1, 0, 0], up: [0, -1, 0] };
      case 270: return { right: [0, 1, 0], up: [-1, 0, 0] };
      default: return { right: [1, 0, 0], up: [0, 1, 0] };
    }
  }

  _motion(e) {
    const rr = e.rotationRate;
    if (!rr || rr.alpha === null) return;
    const now = e.timeStamp || performance.now();
    let dt = this.lastT ? (now - this.lastT) / 1000 : 0;
    this.lastT = now;
    if (dt <= 0 || dt > 0.1) dt = e.interval ? (e.interval > 1 ? e.interval / 1000 : e.interval) : 1 / 60;

    // Angular velocity in device space (deg/s): x = beta, y = gamma, z = alpha.
    const w = [rr.beta || 0, rr.gamma || 0, rr.alpha || 0];
    const g = e.accelerationIncludingGravity;
    if (g && g.x !== null) {
      const s = IOS ? -1 : 1; // iOS reports the opposite sign to Android
      const v = [g.x * s, g.y * s, g.z * s];
      const len = Math.hypot(...v) || 1;
      this.gravity = v.map((c) => c / len);
      this.accelG = { x: v[0] / 9.81, y: v[1] / 9.81, z: v[2] / 9.81 };
    }
    const cfg = this.cfg || {};
    const { right, up } = this._screenAxes();
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    // Yaw: around the screen's up axis ("local") or around real-world up ("player").
    const yawAxis = cfg.space === 'player' && this.gravity ? this.gravity : up;
    let lookX = -dot(w, yawAxis) - (cfg.roll || 0) * w[2];
    let lookY = dot(w, right);
    this.raw = { p: lookY, y: -dot(w, up), r: w[2] };

    // Deadband, then tiered smoothing: small (shaky) motion is averaged, fast motion stays raw.
    const dead = cfg.deadband || 0;
    if (Math.hypot(lookX, lookY) < dead) { lookX = 0; lookY = 0; }
    const n = Math.max(1, cfg.smoothing | 0);
    this.history.push([lookX, lookY]);
    while (this.history.length > n) this.history.shift();
    const avg = this.history.reduce((a, h) => [a[0] + h[0] / this.history.length, a[1] + h[1] / this.history.length], [0, 0]);
    const t = cfg.threshold || 0;
    const mag = Math.hypot(lookX, lookY);
    const direct = t <= 0 ? 1 : Math.min(1, Math.max(0, (mag - t / 2) / (t / 2)));
    lookX = lookX * direct + avg[0] * (1 - direct);
    lookY = lookY * direct + avg[1] * (1 - direct);

    if (cfg.invertX) lookX = -lookX;
    if (cfg.invertY) lookY = -lookY;
    this.rate = { x: lookX, y: lookY };
    this.lastEventAt = performance.now();
    this.accX += lookX * dt;
    this.accY += lookY * dt;
  }

  // Current look rate (deg/s). Zero if the sensor has gone quiet, so a stalled
  // sensor can never leave the camera spinning.
  current() {
    if (!this.lastEventAt || performance.now() - this.lastEventAt > 150) return { x: 0, y: 0 };
    return this.rate;
  }

  // Degrees turned since the last call.
  take() {
    const d = { x: this.accX, y: this.accY };
    this.accX = 0;
    this.accY = 0;
    return d;
  }

  reset() {
    this.accX = 0; this.accY = 0; this.history = []; this.rate = { x: 0, y: 0 };
  }
}
