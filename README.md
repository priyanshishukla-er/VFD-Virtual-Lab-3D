# 3D Variable Frequency Drive (VFD) & Induction Motor Virtual Lab

An interactive, industrial-grade 3D simulation website built with **HTML5**, **CSS3**, **JavaScript (ES6)**, and **Three.js**.

---

## ⚡ Features Overview

1. **Realistic 3D VFD Control Panel**:
   - High-visibility procedural 3D chassis with rear aluminum heatsink cooling fins.
   - Dynamic 7-segment digital LED display generated via HTML5 Canvas texture (`RUN`, `Hz`, `RPM`, `V`, `A`, and error trip codes).
   - Interactive mechanical **START** (Green), **STOP** (Red), and **RESET** (Blue) push buttons with tactile depression animations.
   - Interactive 3D rotary potentiometer knob with position indicator for direct frequency tweaking.
   - Color-coded power & motor terminal blocks with screw studs ($L_1, L_2, L_3, PE$ and $U, V, W, PE$).
   - Operational status LEDs for `PWR`, `RUN`, and `FAULT`.

2. **3D 3-Phase Induction Motor**:
   - 4-Pole 2.2 kW / 3.0 HP squirrel cage induction motor with longitudinal cooling fins.
   - Cast iron drive-end and non-drive-end bearing shields.
   - Heavy mounting feet bolted securely to the workbench.
   - Terminal junction box with cable glands.
   - Drive shaft with keyway and dual-color high-contrast stroboscopic inertia wheel for clear rotational speed perception.
   - Internal cooling fan visible behind the rear protective grill spinning in synchronization with rotor speed.
   - Subtle mechanical vibration simulation that responds to motor load.

3. **Interactive Wiring & Current Flow Visualization**:
   - 3-Phase Mains AC Supply wiring ($L_1, L_2, L_3$) from the distribution breaker box to VFD input.
   - Inverter output cables ($U, V, W$) connecting the VFD to the motor terminal box.
   - Animated glowing current pulses traversing along the wire paths; particle velocity directly scales with output frequency ($0 - 60\text{ Hz}$).
   - Toggle button to turn current flow animation on or off.

4. **Real-Time VFD Physics & Motor Dynamics Engine**:
   - **$V/f$ Scalar Control**: Constant torque control up to 50 Hz with low-frequency voltage boost.
   - **Synchronous Speed Calculation**: $N_{sync} = \frac{120 \times f}{P}$ ($P = 4$).
   - **Rotor Slip Physics**: Slip $s$ dynamically responds to mechanical load ($0\%$ no-load up to $125\%$ overload), causing rotor RPM to pull back realistically from synchronous speed.
   - **Current & Torque Models**: Incorporates magnetizing current, load current, and inrush acceleration currents.
   - **Thermal & Fault Simulation**: Overload detection (`E.OL`), DC bus overvoltage (`E.OV`), and clearable trips via the **RESET** button.

5. **Industrial Web Audio Synthesizer**:
   - Real-time synthesized motor whine and inverter carrier frequency using the Web Audio API.
   - Mechanical contactor and relay sound effects on START, STOP, and FAULT.

6. **Real-Time 3-Phase Oscilloscope**:
   - Dual-mode Canvas waveform monitor:
     - **Sine Wave Mode**: $120^\circ$ phase-shifted fundamental voltages ($V_U, V_V, V_W$).
     - **PWM Inverter Mode**: High-frequency carrier pulse-width modulation showing actual inverter switching pulses.

7. **Professional SCADA Operator Station UI**:
   - Dark industrial theme with glassmorphism panels and responsive layout.
   - Accel/Decel ramp tuning sliders ($t_{acc}$, $t_{dec}$).
   - Forward/Reverse direction toggle and Jog mode (5 Hz).
   - Camera preset angles (Overview, VFD Panel Close-up, Motor Inspection, Wiring/Terminals, Top View).
   - Guided lab experiments drawer.

---

## 🚀 How to Run the Website

### Option 1: Direct File Launch
Simply double-click [`index.html`](file:///c:/VFD-Virtual-Lab-3D/index.html) in Windows File Explorer or open it in any modern browser (Chrome, Edge, Firefox, Brave).

### Option 2: Using the Included Batch File
Double-click [`start_lab.bat`](file:///c:/VFD-Virtual-Lab-3D/start_lab.bat) in the project folder, then open:
```
http://localhost:8000
```

### Option 3: Using Python HTTP Server in Terminal
Run the following command in PowerShell / Command Prompt inside the project directory:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` in your browser.

---

## 🎮 Controls & Interaction Guide

* **Rotate Camera**: Click and drag with Left Mouse Button.
* **Zoom**: Mouse Scroll Wheel.
* **Pan Camera**: Click and drag with Right Mouse Button.
* **Interact in 3D**: Left-click directly on the VFD Start, Stop, Reset buttons, or the Potentiometer dial in the 3D scene.
* **Camera Views**: Select presets from the top header dropdown (`Overview`, `VFD Panel`, `Induction Motor`, `Wiring / Terminals`, `Top View`).
