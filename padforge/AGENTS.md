# PadForge

## Owner agent
- Session: PadForge handoff (Claude Code desktop) — https://claude.ai/code/c0537039-e51c-411e-8403-c2e9df90ecea
- Machine: jim
- Working directory: C:\Users\Jim\padforge-2048AI
- Plan doc: padforge/docs/PLAN.md

## Rules
- The bridge injects keyboard, mouse and gamepad input into the host PC. It listens on the
  Tailscale address only by default; never make it listen on 0.0.0.0 by default, and keep the
  pairing-code lockout test passing.
- The Android APK is published tailnet-only on michelle (see PLAN.md), never on a public host
  without Josh's go.
