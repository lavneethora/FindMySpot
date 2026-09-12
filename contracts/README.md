# The contract

This directory is the interface between the two lanes. The vision lane (Python) produces it,
the web lane (React) consumes it. Neither side needs to read the other's code.

**Additive changes only.** You may add a field. You may never rename or remove one. If you
think a field needs to change shape, stop and sync with the other person first, because the
other lane is already coding against it.

## Files

| File | What it is |
|---|---|
| `state.schema.json` | One live state message. Sent on the WebSocket whenever occupancy changes |
| `layout.schema.json` | Static lot geometry. Fetched once at load |
| `mock_state.json` | A single valid state message, for fixtures and tests |
| `mock_layout.json` | A 28 stall layout (rows A and B, 14 each), valid against the layout schema |
| `mock_sequence.json` | 10 sequential states for the mock replay loop |

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/layout` | One layout object. Fetch once at load |
| `GET` | `/api/state` | The current state object. Useful for a cold start |
| `WS` | `/ws` | A stream of state objects, pushed on every change |
| `GET` | `/video` | MJPEG stream of the annotated camera view. Use as an `<img>` src |
| `POST` | `/api/hold` | Body `{"spot_id": "A7"}`. Places a 90 second hold and returns `{"spot_id", "held_until", "route": [[x, y], ...]}` |
| `GET` | `/api/analytics` | Occupancy over time from the continuous aggregate |

## The mock sequence

`mock_sequence.json` exists so the frontend can build and polish the entire demo without the
Python pipeline running. Loop through the frames on a timer behind `VITE_USE_MOCK=1`.

Frame 4 is the important one. Stall **A7** flips from `occupied` to `available`, `last_event`
fires, the available count goes from 6 to 7, and vehicle 12 starts moving toward the aisle.
That transition is the centrepiece of the demo, so build the animation against it.

## Coordinates

Everything positional is **normalized to 0..1 in top-down space**, origin top left. The entrance
sits at the bottom of the map.

The vision lane warps camera pixels through the homography before sending anything, so the
frontend never does geometry. If you find yourself writing a perspective transform in React,
something has gone wrong: ask for the field instead.
