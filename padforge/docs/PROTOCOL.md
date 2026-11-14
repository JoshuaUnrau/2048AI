# Phone ↔ bridge protocol (v1)

JSON messages over a WebSocket at `ws(s)://<bridge>/ws`. This is also the starting point for third-party clients and, later, game plugins.

## Handshake

```jsonc
// phone → bridge (first message, within 5 s)
{ "t": "hello", "token": "123456", "clientId": "uuid-kept-by-the-phone", "name": "Android", "v": 1 }
// bridge → phone
{ "t": "welcome", "clientId": "…", "player": 1,
  "output": { "output": "vigem-x360", "controller": "Xbox 360 (ViGEm)", "gyroPassthrough": false, "kbm": true },
  "layouts": [{ "id": "standard", "name": "Standard gamepad", "match": [], "builtin": true, "modified": false }],
  "foreground": { "exe": "game.exe", "layoutId": null } }
```

- A wrong token gets `{ "t": "error", "code": "auth" }`, and the socket closes with code 4003.
- Reconnecting with the same `clientId` within 15 s keeps the same player slot and virtual pad.

## Input

The phone sends its **entire input state**. It sends whenever something changes, and at least every 100 ms as a heartbeat:

```jsonc
{ "t": "pad",
  "b": ["A", "LB", "UP"],            // A B X Y LB RB LS RS BACK START GUIDE UP DOWN LEFT RIGHT TOUCHPAD
  "lx": 0.0, "ly": 1.0,             // sticks -1..1, +y = up
  "rx": 0.0, "ry": 0.0,
  "lt": 0.0, "rt": 0.75,            // triggers 0..1
  "k": ["KeyW", "ShiftLeft"],       // held keys (KeyboardEvent.code names)
  "m": ["left"],                    // held mouse buttons: left / right / middle
  "g": { "p": 0, "y": 0, "r": 0 },  // optional raw gyro deg/s (DS4 passthrough)
  "a": { "x": 0, "y": 0, "z": 1 } } // optional accelerometer in g
```

- Because state is absolute, a lost packet can't leave a key stuck.
- If a phone is silent for 1 s, the bridge releases all of its inputs.

Relative events:

```jsonc
{ "t": "mouse", "dx": 12, "dy": -3 }
{ "t": "wheel", "n": 1 }
```

## Bridge → phone

```jsonc
{ "t": "rumble", "large": 0.8, "small": 0.2 }         // 0..1, from the game
{ "t": "foreground", "exe": "eldenring.exe", "layoutId": "elden" }
{ "t": "layout.list", "layouts": [ … ] }
{ "t": "pong", "ts": 1234.5 }
```

## Layouts

```jsonc
{ "t": "layout.get", "id": "standard", "req": 1 }    → { "t": "layout", "layout": { … }, "req": 1 }
{ "t": "layout.save", "layout": { … }, "req": 2 }    → { "t": "layout.saved", "id": "…", "req": 2 }
{ "t": "layout.delete", "id": "…", "req": 3 }        → { "t": "layout.deleted", "id": "…", "req": 3 }
{ "t": "ping", "ts": 1234.5 }                         → { "t": "pong", "ts": 1234.5 }
```

### Layout format

```jsonc
{
  "id": "my-game", "name": "My game", "match": ["mygame.exe"],
  "settings": { "haptics": true, "slide": true, "showTabs": true },
  "gyro": { "enabled": true, "output": "right", "mode": "always", "space": "player", "stickRate": 150 },
  "common": [ /* controls shown on every screen */ ],
  "screens": [
    { "id": "main", "name": "Main", "gyro": true, "hideCommon": false, "controls": [
      { "id": "c1", "type": "button", "x": 86, "y": 68, "s": 14, "a": 1, "bind": "A", "label": "Jump" }
    ] }
  ]
}
```

Positions and sizes:

- `x`, `y` are the control's centre, in % of screen width and height.
- `s` is the control's height, in % of screen height.
- `a` is width ÷ height.

Control types are `button`, `stick`, `dpad`, `trigger`, `touchpad` and `label`. Each type's options are listed in `app/js/schema.js`.

Button `bind` values can be joined with `+` to make combos:

| Bind | What it does |
|---|---|
| `A`, `B`, `X`, `Y`, `LB`, `RB`, `LS`, `RS`, `BACK`, `START`, `GUIDE`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `TOUCHPAD` | Gamepad buttons |
| `LT`, `RT` | Triggers, pressed fully |
| `key:<code>` | A keyboard key |
| `mouse:left`, `mouse:right`, `mouse:middle` | Mouse buttons |
| `wheel:up`, `wheel:down` | Mouse wheel |
| `screen:next`, `screen:prev`, `screen:<id>` | Change screen |
| `hold:<id>` | Show that screen while held |
| `gyro:hold`, `gyro:off`, `gyro:toggle` | Motion controls on while held, off while held, or toggle |
