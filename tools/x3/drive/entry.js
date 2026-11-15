  // as it comes: nose-first, left-hand drive, Alpine White under a black panoramic roof, on 21s with blue M calipers. Prep
  // names its parts by role, splits the lamps' baked-lit glow map by role (the DRLs lit, the projectors with the
  // headlights, the third brake light only braking, the reversing lights in R) and cuts what no camera can see
  x3: {
    name: 'BMW X3 M40i', page: 'bmw-x3-m40i', model: '/models/bmw-x3-m40i.glb?v=1', length: 4.716, wheelbase: 2.864, redline: 7000,
    credit: ['2024 BMW X3 M40i', 'https://sketchfab.com/3d-models/2024-bmw-x3-m40i-d35d04aac7f242d997af5d8d2d7fbeca'],
    grip: 2.0, stiff: 0.85, // M Sport suspension on a tall SUV: firmer than the X1's, more roll than any saloon here
    chassis: { m: 1955, front: 0.52, rear: 0.6, h: 0.6 }, // xDrive, rear-biased; an SUV's high CG
    paint: /\|paint_\d+\|/, paintColor: 0xf2f2ee, glass: /\|glass_\d+\|/, glassPlain: true, // Alpine White, its own colour
    paintMat: { metalness: 0.05, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 }, // solid paint under clear coat
    wheels: /\|wheel_(rim|tyre|disc)_\d\|/, tyre: /\|wheel_tyre_\d\|/, // the calipers stay put
    // (depth: the paddles sit 8 cm behind the rim); the live cluster just in front of the model's own (blacked) screen, as wide
    steering: { re: /\|cabin_steering_\d\|/, near: [0.377, 1.076, 0.337], depth: 0.1, look: 0.1, inset: 0.03, size: 0.39 },
    tail: { re: /\|tail_lights_\d\|/, idle: 0.25, brake: 6 }, // (2: the third brake light, a third as bright: dark until braking)
    // the signals and the brake glow on the body's outer lamps; reverse: the white bar along each tailgate lamp's foot
    lamps: { head: /\|head_lights_\d\|/, tail: /\|tail_lights_1\|/, mirror: /\|mirror_lights_\d\|/, reverse: /\|reverse_lights_\d\|/ },
    exhaustX: 0.56, exhaustBoth: true, // a round tip at each end of the diffuser
    arrows: [40.86, 61.32, 23.81], // over the OS7 display's own arrow telltales
  },
