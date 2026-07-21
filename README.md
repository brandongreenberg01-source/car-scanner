# Scanner — OBD-II app for the 2011 Range Rover HSE

A minimal iPhone diagnostic app that talks to a Bluetooth **BLE** ELM327 adapter.
Reads and clears fault codes, shows live engine data, and reports emissions
readiness.

Built as an Expo/React Native app and sideloaded with a free Apple ID — same
pipeline as GHOSTLIGHT.

---

## ⚠️ Read this first: will your adapter work?

**iPhones cannot talk to classic Bluetooth (3.0 / SPP) OBD adapters.** That is a
hard Core Bluetooth limitation — no app, including this one, can work around it.
Only **BLE (Bluetooth 4.0+)** adapters are reachable from iOS.

Your ymobd.com dongle does not advertise BLE anywhere on the box, so it may well
be a classic SPP unit. **The app's Scan screen is the test** — it lists every BLE
device nearby, unfiltered:

| What you see | What it means |
|---|---|
| Adapter appears in the app's scan list | It's BLE. You're good. |
| Adapter never appears in the app, but *does* show up in **iOS Settings → Bluetooth** asking to pair with PIN `1234` | Classic SPP. Unusable on any iPhone. |

If it's classic, a **Vgate iCar Pro BLE** or **Veepeak BLE+** (~$20–30) drops in
and this app works unchanged — no code edits needed.

You can also settle it before building anything: plug the adapter into the car,
turn the ignition on, and look at iOS Settings → Bluetooth. A pairing prompt with
a PIN is the signature of a classic adapter. BLE adapters deliberately do *not*
appear there.

## What this reads (and what it can't)

Generic OBD-II reaches the **engine and transmission** only:

- Stored, pending and permanent fault codes, in plain English
- Clear codes / reset the check engine light
- Live data: RPM, speed, coolant and oil temp, fuel trims, MAF, load, throttle,
  module voltage
- Emissions readiness monitors (the "will it pass inspection" answer)
- VIN

It **cannot** reach air suspension, ABS, the transfer case, SRS, or the body
modules. Those sit on Land Rover–specific diagnostic protocols that a
passthrough ELM327 adapter has no access to. For those you need a JLR tool
(SDD/Pathfinder, or a Foxwell/Autel unit with Land Rover coverage).

Manufacturer-specific codes (`P1xxx`, `C1xxx`, `B1xxx`, `U1xxx`) are shown and
flagged as Land Rover–specific rather than given an invented description — the
app never guesses at a definition it doesn't have.

## Build and install

```sh
cd app
npm install
npm test                 # 34 decoder checks, no framework, no device needed
```

The IPA is built in CI, because compiling iOS native code needs Xcode 16:

1. Push this repo to GitHub.
2. Actions → **ios-unsigned** → *Run workflow*.
3. Download the `car-scanner-unsigned-ipa` artifact.
4. Sign and install it with **Sideloadly** using your free Apple ID.

Free-Apple-ID signing expires after **7 days**. Re-run Sideloadly to refresh it —
the app and its data stay put.

## Using it in the car

1. Adapter into the OBD port — under the dash, left of the steering column.
2. Ignition to position II (or engine running). The adapter needs the bus awake.
3. Open the app → **Vehicle** → *Scan for adapters* → tap yours.
4. **Codes** reads faults; **Live** shows real-time data.

Clearing codes also erases the emissions readiness monitors. The app warns you
before it does: the car will fail an emissions test until they refill, which
takes a few days of mixed driving. And if the fault is still there, the code
comes straight back — which is itself useful information.

## Layout

```
app/
  App.js                  tab shell
  src/
    ble.js                BLE transport — discovers characteristics by property,
                          not by a hardcoded UUID table, so unknown clones work
    store.js              zustand state + polling loop
    theme.js
    obd/
      elm327.js           command protocol, response framing, ISO-TP reassembly
      dtc.js              fault code bit decoding + description table
      pids.js             live data formulas (SAE J1979) in US units
      obd.test.js         run with `npm test`
    screens/
```

The `obd/` folder is pure JavaScript with no React Native imports, which is why
the test suite runs directly in Node with no build step or test framework.
