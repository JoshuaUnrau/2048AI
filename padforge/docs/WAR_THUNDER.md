# War Thunder flight layout

Hold the phone sideways like a yoke:

| You do | The plane does | Controller output |
|---|---|---|
| Tilt like a steering wheel | Roll | Left stick X |
| Lean the top away / toward you | Nose down / up | Left stick Y |
| Turn the phone left / right | Rudder (eases back to centre) | Right stick X |
| Slide the **Throttle** (left edge) | Throttle (stays where you leave it; detents at 0, 50 and 100%) | Right stick Y |
| **Volume up** / **MG** button | Light guns (machine guns) | RT |
| **Volume down** / **Cannon** button | Heavy guns (cannons) | LT |
| **All guns** | Both | RT + LT |
| **Flaps ▲** / **Flaps ▼** | Flaps up / down | D-pad up / down |
| **Gear** | Landing gear | Y |
| **Airbrake**, **Rockets**, **Bombs** | | B, X, A |
| **Zoom**, **Lock** | | RB, LB |
| **Centre** | Sets "level" to how you're holding the phone right now | |

The layout switches on automatically when War Thunder (`aces.exe`) is focused on Windows.

> **Volume buttons:** browsers keep the volume keys for themselves, so in the current web version use the **MG** and **Cannon** buttons. The layout is already set up for the volume keys, and they'll work once PadForge is a native app. Native support on Android is straightforward; on iPhone it relies on a workaround.

## One-time setup in War Thunder

1. Start the PadForge bridge and connect your phone. War Thunder sees an Xbox 360 controller.
2. In War Thunder, open **Controls**:
   - Use a control mode where the **stick flies the plane directly**, not mouse aim. For **Realistic**, choose the joystick-based setup without mouse aim. For **Simulator**, use full real controls, typically with the Instructor turned off.
   - Exact menu names vary between game versions.
3. Under the aircraft **axes**, assign each one by moving that control on the phone:
   - **Roll:** tilt the phone left and right.
   - **Pitch:** lean the phone forward and back.
   - **Yaw (rudder):** turn the phone.
   - **Throttle:** switch the phone to the **Menu** tab first (motion is off there, but the throttle stays on screen), then slide the throttle.

   Doing throttle from the Menu tab stops War Thunder from picking up the phone's tilt instead of the slider.
4. **Turn off** War Thunder's extra dead zone and non-linearity on these axes (or keep them small). PadForge already applies its own, adjustable in the editor under **✎ → Motion**.
5. Assign buttons the same way: in War Thunder's assignment screen, press **Flaps ▲**, **Gear**, **MG** and so on on the phone.

Whether the top of the throttle engages WEP depends on War Thunder's throttle settings.

## Tuning (✎ → Motion)

- **Degrees for full deflection:** lower values make it more sensitive. Defaults are roll 40°, pitch 30°, rudder 25°.
- **Response curve:** above 1 gives finer control near centre, which helps when aiming.
- **Yaw behaviour:** "eases back" acts like a rudder that springs back to centre. "Turning speed" maps how fast you turn.
- **Invert pitch:** use this if leaning the top away should pull up instead.
- **Centre:** tap it whenever you change how you're sitting.
