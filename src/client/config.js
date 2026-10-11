// Shared client constants: tuning, colours, cosmetics and objectives.

// Game constants
export const GAME_CONFIG = {
  CAMERA_FOV: 75,
  CAMERA_NEAR: 0.5,
  CAMERA_FAR: 2000,
  CAMERA_DISTANCE: 20,
  CAMERA_HEIGHT: 10,

  CHUNK_SIZE: 200,
  VIEW_DISTANCE: 3,
  FOG_NEAR: 300,
  FOG_FAR: 950,
  GROUND_SIZE: 2000,

  PROJECTILE_DESPAWN_DIST: 340,

  FLIGHT_HEIGHT: 42,          // cruise altitude: above spires, lighthouses and poplars
  PLANE_COLLISION_RADIUS: 4,
  CRASH_DURATION: 1400,
  CRASH_HEALTH_PENALTY: 20,   // must match server CRASH_DAMAGE
  CRASH_GRACE: 2.0,           // seconds of collision immunity after a crash respawn
  PROJECTILE_SPEED: 220,      // must match server PROJECTILE_SPEED
  FIRE_COOLDOWN: 0.15,

  // Targeting
  LOCK_RANGE: 360,            // enemies farther than this get no bracket
  LOCK_CONE: 22,              // degrees off the nose to show the bracket + lead circle
  AIM_ASSIST_CONE: 12,        // degrees inside which shots bend onto the lead point
  AIM_ASSIST_SNAP: 6,         // inside this, shots snap fully
  CLIENT_HIT_RADIUS: 8,       // your bullets hit what they visibly pass through (units)

  // Altitude (the third dimension!)
  MIN_ALTITUDE: 8,            // ground-skimming floor
  MAX_ALTITUDE: 110,          // ceiling
  MAX_PITCH: 0.5,             // rad of nose-up/down at full climb/dive input
  PITCH_SMOOTHING: 5,         // how quickly pitch eases toward input
  RESPAWN_ALTITUDE: 60,       // post-crash climb-out height (above every obstacle)
  MOUSE_SENSITIVITY: 0.0022,  // stick deflection per pixel of mouse travel
  MOUSE_STICK_DECAY: 2.2,     // how quickly the virtual stick re-centres (per second)
  CONTROLS_PANEL_SECONDS: 25, // the key legend hides itself after this long in the air

  // Contrails & Smoke
  TRAIL_MAX_POINTS: 80,
  SMOKE_HEALTH_THRESHOLD: 50,
  FIRE_HEALTH_THRESHOLD: 25,
  SMOKE_SPAWN_RATE: 0.08,

  // Weather
  WEATHER_HOLD_MIN: 40,
  WEATHER_HOLD_MAX: 70,
  WEATHER_TRANSITION_DURATION: 10,
  RAIN_COUNT: 4000,

  // Windmill Capture
  CAPTURE_RADIUS: 50,
  CAPTURE_RING_RADIUS: 8,

  // Takeoff
  TAKEOFF_ACCEL_DURATION: 2.0,
  TAKEOFF_LIFTOFF_DURATION: 1.5,
  TAKEOFF_CLIMB_DURATION: 2.0,
  RUNWAY_LENGTH: 200,
  RUNWAY_WIDTH: 15,

  MOVEMENT_SPEED: 50,
  BOOST_SPEED: 100,

  // Energy flight model
  STALL_SPEED: 27,        // below this the nose drops until speed returns
  STALL_RECOVER: 34,
  DIVE_MAX_SPEED: 135,
  GRAVITY_GAIN: 32,       // speed gained per second in a full dive (lost climbing)
  TURN_DRAG: 7,           // speed lost per second at full turn rate
  THRUST_RESPONSE: 0.9,   // how quickly the engine pulls speed back toward cruise
  ROLL_SPEED_COST: 10,

  // Turning & banking
  TURN_RATE: 3,          // max turn rate (rad/s)
  TURN_SMOOTHING: 6,     // how quickly turn rate ramps toward input (per second)
  MAX_BANK_ANGLE: 0.55,  // visual roll at full turn (rad, ~31°)
  BANK_SMOOTHING: 5,     // how quickly the roll eases toward its target

  // Throttle
  THROTTLE_MIN: 0.35,
  THROTTLE_MAX: 1.5,
  THROTTLE_RATE: 0.6,    // throttle change per second while held

  // Tulip power-ups
  PICKUP_RADIUS: 9,
  PICKUP_SPAWN_CHANCE: 0.5,       // per chunk
  SPEED_SURGE_DURATION: 5,        // seconds of golden tulip speed surge
  SPEED_SURGE_MULTIPLIER: 1.5,

  // Barrel roll
  ROLL_DURATION: 0.7,
  ROLL_COOLDOWN: 2.0,
  ROLL_DODGE_SPEED: 45,           // sideways dodge speed during a roll

  // Radar
  RADAR_RANGE: 500,               // world units shown on the minimap
  ENERGY_DRAIN_RATE: 20,
  ENERGY_REGEN_RATE: 10,

  PROJECTILE_COLOR: 0xFFE9A8,

  USERNAME_MAX_LENGTH: 15,
  USERNAME_MIN_LENGTH: 1,
  CHAT_MESSAGE_MAX_LENGTH: 200,

  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 1000,
  NET_SEND_INTERVAL: 50,      // ms between position packets (20 Hz)

  // Arena: land inside the dike, sea beyond it
  ARENA_RADIUS: 2400,
  COAST_BAND: 70,             // chunks whose centre is this close to the dike get beach-only scenery
  BOUNDARY_ASSIST: 1.6,       // turn-rate nudge back toward the arena when outside

  // Environment
  DAY_CYCLE_MINUTES: 16,      // real minutes per in-game day
  START_HOUR: 8.5,
  GROUND_TILE: 24,            // world units per grass texture tile
};

// Unique vibrant colors for each player
export const PLAYER_COLORS = [
  0xFF3E3E, 0x3EA8FF, 0xFF9F1C, 0x2ECC71,
  0x9B59B6, 0xF1C40F, 0x1ABC9C, 0xE91E9C,
  0x00D4FF, 0xFF6B6B, 0x45B7D1, 0xFFA07A,
];

// Cosmetic unlocks by pilot level (XP is banked per match)
export const PAINTS = {
  classic:  { level: 1,  label: 'Classic',  body: null,     accent: null },
  delft:    { level: 4,  label: 'Delft',    body: 0xF4F4F0, accent: 0x1F5FBF },
  tulip:    { level: 7,  label: 'Tulip',    body: 0xE8384F, accent: 0xFFD23F },
  midnight: { level: 10, label: 'Midnight', body: 0x1A1D2B, accent: 0x9FE1FF },
  gold:     { level: 14, label: 'Gold',     body: 0xD4A017, accent: 0xFFF3C0 },
};
export const TRAILS = {
  white:  { level: 1,  label: 'White',  color: 0xFFFFFF },
  tulip:  { level: 3,  label: 'Tulip',  color: 0xFF6B7A },
  orange: { level: 5,  label: 'Orange', color: 0xFFA040 },
  gold:   { level: 8,  label: 'Gold',   color: 0xFFD23F },
  delft:  { level: 11, label: 'Delft',  color: 0x6FB3FF },
};
export const STORK_LEVEL = 12;

export const CAPTURE_WINDMILLS = [
  { id: 'mill_n', x: 0, z: -300, name: 'North' },
  { id: 'mill_s', x: 0, z: 300, name: 'South' },
  { id: 'mill_e', x: 300, z: 0, name: 'East' },
  { id: 'mill_w', x: -300, z: 0, name: 'West' },
  { id: 'mill_c', x: 200, z: -200, name: 'Hill' },
];
