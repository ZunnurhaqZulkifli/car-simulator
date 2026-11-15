  // GT Cars: Hyperspeed's M3 with its whole cabin: turned nose-first, left-hand drive as built, its own blue under the
  // carbon roof, on gold-caliper 19s. Prep cuts the wheels and the steering wheel out of its merged meshes, names every
  // part by role, keys its lamps (corona rings lit as DRLs, projectors with the headlights, tail lenses, reversing panes),
  // gives its parts finishes three.js shows right, cuts what no camera sees and simplifies the rest
  f80: {
    name: 'BMW M3 F80', page: 'bmw-m3-f80', model: '/models/bmw-m3-f80.glb?v=2', length: 4.671, wheelbase: 2.812, redline: 7600,
    credit: ['BMW M3 (F80)', 'https://sketchfab.com/3d-models/bmw-m3-f80-7be23191bef447f68133afbf63f1e669', 'by', 'GT Cars: Hyperspeed', 'https://sketchfab.com/Car2022'],
    grip: 2.2, stiff: 2, wind: 8, // Pilot Super Sports on adaptive M suspension: firmer than the E60's, softer than the CS cars'
    chassis: { m: 1595, front: 0.52, rear: 1 },
    paint: /\|paint_\d+\|/, paintColor: 0x0089ee, glass: /\|glass_\d+\|/, glassPlain: true, // the model's own blue
    paintMat: { metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 }, // metallic under clear coat
    wheels: /\|wheel_(rim|tyre|disc)_\d+\|/, tyre: /\|wheel_tyre_\d+\|/, // the calipers stay put
    // (the rim's circle fit, raised 1.2 cm in prep for the seat; depth: the hub's back); the cluster on the binnacle's
    // blacked dial faces, as wide as the wheel's upper opening lets it
    steering: { re: /\|cabin_steering_\d+\|/, near: [0.362, 0.91, 0.423], depth: 0.08, look: 0.1, inset: 0.03, size: 0.42 },
    tail: { re: /\|tail_lights_\d+\|/, idle: 0.25, brake: 6 },
    lamps: { head: /\|head_lights_\d+\|/, tail: /\|tail_lights_\d+\|/, reverse: /\|reverse_lights_\d+\|/ }, // reverse: the white panes in the boot-lid lamps
    exhaustX: 0.33, exhaustBoth: true, // a pair of tips each side
  },
