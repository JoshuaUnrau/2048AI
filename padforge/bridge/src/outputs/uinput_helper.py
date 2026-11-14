#!/usr/bin/env python3
"""PadForge Linux helper: creates virtual Xbox 360 pads + a keyboard/mouse via uinput.

Reads one JSON command per line on stdin. Needs python-evdev (pip install evdev)
and write access to /dev/uinput (add your user to the 'input' group, or a udev rule).
Steam and SDL recognise the pads as Xbox 360 controllers by their USB IDs.
"""
import json
import sys

from evdev import UInput, AbsInfo, ecodes as e

PAD_BUTTONS = {
    "A": e.BTN_SOUTH, "B": e.BTN_EAST, "X": e.BTN_WEST, "Y": e.BTN_NORTH,
    "LB": e.BTN_TL, "RB": e.BTN_TR, "LS": e.BTN_THUMBL, "RS": e.BTN_THUMBR,
    "BACK": e.BTN_SELECT, "START": e.BTN_START, "GUIDE": e.BTN_MODE,
}
STICK = AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)
TRIG = AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)
HAT = AbsInfo(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)

pads = {}
kbm = None


def make_pad(slot):
    caps = {
        e.EV_KEY: list(PAD_BUTTONS.values()),
        e.EV_ABS: [
            (e.ABS_X, STICK), (e.ABS_Y, STICK), (e.ABS_RX, STICK), (e.ABS_RY, STICK),
            (e.ABS_Z, TRIG), (e.ABS_RZ, TRIG), (e.ABS_HAT0X, HAT), (e.ABS_HAT0Y, HAT),
        ],
    }
    return UInput(caps, name="Microsoft X-Box 360 pad", vendor=0x045E, product=0x028E,
                  version=0x110, bustype=e.BUS_USB)


def get_kbm():
    global kbm
    if kbm is None:
        keys = [v for k, v in e.ecodes.items() if k.startswith("KEY_") and isinstance(v, int) and v < 0x200]
        keys += [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE]
        kbm = UInput({e.EV_KEY: keys, e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL]}, name="PadForge Keyboard/Mouse")
    return kbm


def stick(v, invert=False):
    v = max(-1.0, min(1.0, float(v)))
    if invert:
        v = -v
    return int(v * 32767)


def handle(m):
    op = m.get("op")
    if op == "create":
        pads[m["slot"]] = make_pad(m["slot"])
    elif op == "destroy":
        dev = pads.pop(m["slot"], None)
        if dev:
            dev.close()
    elif op == "pad":
        dev = pads.get(m["slot"])
        if not dev:
            return
        b = set(m.get("b", []))
        for name, code in PAD_BUTTONS.items():
            dev.write(e.EV_KEY, code, 1 if name in b else 0)
        dev.write(e.EV_ABS, e.ABS_X, stick(m.get("lx", 0)))
        dev.write(e.EV_ABS, e.ABS_Y, stick(m.get("ly", 0), invert=True))  # evdev: +Y is down
        dev.write(e.EV_ABS, e.ABS_RX, stick(m.get("rx", 0)))
        dev.write(e.EV_ABS, e.ABS_RY, stick(m.get("ry", 0), invert=True))
        dev.write(e.EV_ABS, e.ABS_Z, int(max(0, min(1, m.get("lt", 0))) * 255))
        dev.write(e.EV_ABS, e.ABS_RZ, int(max(0, min(1, m.get("rt", 0))) * 255))
        dev.write(e.EV_ABS, e.ABS_HAT0X, 1 if "RIGHT" in b else -1 if "LEFT" in b else 0)
        dev.write(e.EV_ABS, e.ABS_HAT0Y, -1 if "UP" in b else 1 if "DOWN" in b else 0)
        dev.syn()
    elif op == "key":
        code = e.ecodes.get(m.get("code"))
        if isinstance(code, int):
            d = get_kbm()
            d.write(e.EV_KEY, code, 1 if m.get("down") else 0)
            d.syn()
    elif op == "mbtn":
        code = {"left": e.BTN_LEFT, "right": e.BTN_RIGHT, "middle": e.BTN_MIDDLE}.get(m.get("button"))
        if code:
            d = get_kbm()
            d.write(e.EV_KEY, code, 1 if m.get("down") else 0)
            d.syn()
    elif op == "mouse":
        d = get_kbm()
        d.write(e.EV_REL, e.REL_X, int(m.get("dx", 0)))
        d.write(e.EV_REL, e.REL_Y, int(m.get("dy", 0)))
        d.syn()
    elif op == "wheel":
        d = get_kbm()
        d.write(e.EV_REL, e.REL_WHEEL, int(m.get("n", 0)))
        d.syn()


def main():
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            handle(json.loads(line))
        except Exception as ex:  # keep running; report to the bridge
            print(json.dumps({"error": str(ex)}), flush=True)


if __name__ == "__main__":
    main()
