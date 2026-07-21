# Scanner — diagnostics for a 2011 Range Rover HSE (L322)

An iPhone app that talks to a Bluetooth **BLE** OBD adapter and reads fault
memory from *individual control modules* over UDS — not just the generic
emissions subset every code reader gives you.

Built because Land Rover dealerships won't service vehicles over 10 years old,
which makes a 2011 L322 unserviceable through official channels.

Sideloaded with a free Apple ID via GitHub Actions — no Apple Developer account.

---

## The two-tool strategy

Neither tool alone covers this truck. They're complementary:

| | Phone app (this repo) | Mongoose cable + SDD |
|---|---|---|
| **Cost** | ~$25–30 BLE adapter | ~$50–150 cable |
| **Where** | In your pocket, instant | Windows VM on a laptop |
| **Reaches** | High-speed CAN modules (pins 6/14) | Everything, both buses |
| **Can do** | Read faults, live data | Faults, calibrations, CCF editing, programming |
| **Good for** | "What's that light?" in a parking lot | Actual repair work |

SDD is the software Land Rover dealers themselves use; **V138** is the version
documented as L322-compatible, and it requires **Windows 7 Pro 32-bit** (not
64-bit), normally distributed as a prebuilt VM image.

> **Practical warning, not a moral one:** cracked diagnostic images are a known
> malware vector. Run the VM with networking disabled and snapshot it before
> first boot.

## ⚠️ Adapter compatibility — check this before anything else

**iPhones cannot talk to classic Bluetooth (3.0 / SPP) OBD adapters.** That's a
Core Bluetooth limitation; no app can work around it. Only **BLE (4.0+)** works.

The app's scan screen is the test — it lists every BLE device nearby, unfiltered:

| What you see | What it means |
|---|---|
| Adapter appears in the app's scan list | It's BLE. Good. |
| Never appears in the app, but *does* appear in **iOS Settings → Bluetooth** asking to pair with PIN `1234` | Classic SPP. Unusable on any iPhone. |

Known-good cheap BLE adapters: **Vgate iCar Pro BLE 4.0** (genuine ELM327 v2.2,
auto-sleep so it won't flatten the battery) or **Veepeak OBDCheck BLE+**.

Don't buy an OBDLink MX+ (~$140) for medium-speed CAN if you're also getting the
Mongoose — the Mongoose already reaches every module on both buses.

## What the app reads

**Modules tab** — the interesting one. Probes candidate CAN addresses, reports
which control modules actually answered, then reads each one's own fault memory
over UDS service `0x19`. Faults come back in factory format (`C1A20-64`) with
the failure type decoded — the difference between "circuit shorted to ground"
and "circuit open" on the same base code.

**Codes tab** — generic OBD-II stored/pending/permanent codes, plain English.

**Live tab** — RPM, speed, coolant and oil temp, fuel trims, MAF, load,
throttle, module voltage. US units.

**Vehicle tab** — VIN, MIL state, emissions readiness monitors.

### Limits, stated honestly

- Only the **high-speed bus** (OBD pins 6/14) is reachable. The L322 also has a
  **medium-speed bus on pins 3/11** terminating at the Central Junction Box —
  most body modules live there and no standard adapter can switch to it.
- Module addresses are probed from a **Ford/Jaguar-derived candidate list**,
  since the 2010–2012 L322 shares that electrical architecture. Anything the
  sweep lists answered for real; anything absent either isn't at that address
  or isn't on this bus. It's discovery, not a verified factory table.
- Modules that require **security access** (seed/key) will say so. The app does
  not attempt those exchanges.
- **Read-only by design.** Write services are enumerated in `uds.js` and never
  sent. Writing to an L322 module can brick it, and some bricked modules are
  immobilising. Use SDD for anything that writes.

*(This vehicle has had its air suspension replaced with springs, so EAS
calibration — normally the main reason to want medium-speed bus access — isn't
a requirement here.)*

## Build and install

```sh
cd app
npm install
npm test          # 51 checks, no framework, no device, no car needed
```

iOS native code needs Xcode 16, so the IPA is built in CI:

1. Actions → **ios-unsigned** → *Run workflow*
2. Download the `car-scanner-unsigned-ipa` artifact
3. Sign and install with **Sideloadly** using your free Apple ID

Free-Apple-ID signing expires after **7 days**; re-run Sideloadly to refresh.

## Using it in the car

1. Adapter into the OBD port — under the dash, left of the steering column.
2. Ignition to position II, or engine running. The bus must be awake.
3. **Vehicle** → *Scan for adapters* → tap yours.
4. **Modules** → *Discover modules* → then *Read faults* per module.

Clearing generic codes also wipes the emissions readiness monitors; the app
warns first. If the fault is still present the code returns immediately — which
is itself a useful result.

## Layout

```
app/
  App.js                  tab shell
  src/
    ble.js                BLE transport — discovers characteristics by property,
                          not a hardcoded UUID table, so unknown clones work
    store.js              zustand state, polling loop, module sweep
    obd/
      elm327.js           command protocol, ISO-TP framing, UDS targeting
      uds.js              ISO 14229 — services, NRCs, 3-byte DTC decoding
      dtc.js              OBD-II fault code decoding + description table
      pids.js             live data formulas (SAE J1979), US units
      obd.test.js         npm test
    screens/
```

`obd/` is pure JavaScript with no React Native imports, which is why the whole
protocol layer is testable in Node with no build step, no framework, and no
hardware. That test suite has already caught two real bugs: CAN zero-padding
decoded as phantom fault codes, and a positive UDS response concatenated after
a `0x78` "pending" making a live module look dead.
