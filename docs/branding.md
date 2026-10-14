# Lunar identity

The moon texture is Cole Crouter's telescope photograph, posterized by Cole in
Photoshop and contributed for Perilune. The original supplied PNG is preserved in
`static/brand/moon-texture.png`; no generated image replaces its surface detail.
It is distributed under the repository's GPL-3.0-only license.

The fixed logo is a waxing crescent with 23% projected illumination and a small
pale-lavender satellite dot. Progress favicons omit that decorative dot so their
status badges remain distinct. The README uses a larger centered mark on a
midnight tile, preserving contrast in both GitHub themes. A calculated SVG
clip gives the photograph a clean circular limb and elliptical terminator.
The app rail, account entry, static favicon and README use the same treatment.
Warm neutrals, teal, midnight blue and lavender remain the established palette.

During printing, the favicon's illuminated area follows rounded percentage
progress. Paused jobs retain their phase with a pause badge; unavailable telemetry
retains its reported phase with an amber badge. Completed jobs show a full moon.
Idle, cancelled, unknown progress and error states return to the crescent logo.
The badge is supplementary; connection and job status remain explicit in the UI.
Updates happen only when whole-percent progress or status changes, without a timer
or animation. Authenticated app pages share the existing dashboard live query;
account entry uses the static favicon. This does not send commands to the printer.

`static/brand/social-card.html` is the 1280×640 repository preview composition.
GitHub's repository settings support a social-preview image, rather than a custom
repository avatar. The README provides an immediately visible repository logo.
