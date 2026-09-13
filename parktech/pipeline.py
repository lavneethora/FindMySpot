"""The replay loop: frames in, state out.

Holds the whole vision path in one place so run.py stays a thin entrypoint.
A day of PKLot stills from a fixed camera is treated as a time lapse: the stall
polygons never move, so occupancy is the only thing that changes between frames.
Replaying a day in ninety seconds is what gives the analytics view a real
occupancy curve instead of a fabricated one.
"""

import threading
import time
from datetime import datetime, timezone

import cv2

from parktech import db, occupancy, pklot

VEHICLE_CLASSES = {2, 5, 7}  # COCO car, bus, truck

# Validated on PUCPR: 97.1% per-stall accuracy, 4 false positives in 1138 free
# stalls. PUCPR has 100 stalls in the same 1280x720 frame, so each car is much
# smaller than on UFPR04 and the smaller model at 1280 collapsed to 63%.
# See scripts/accuracy.py and the PRD before changing any of these.
MODEL = "yolo11m.pt"
IMGSZ = 1920
CONF = 0.15
OVERLAP_THRESHOLD = 0.35


class Pipeline:
    """Replays a camera's frames and publishes occupancy state.

    Runs on its own thread so the web server stays responsive while inference
    happens. Subscribers get a callback on every published frame.
    """

    def __init__(self, camera_dir, camera_id, fps=2.0, loop=True):
        self.camera_dir = camera_dir
        self.camera_id = camera_id
        self.fps = fps
        self.loop = loop

        self.frames = list(pklot.iter_frames(camera_dir))
        if not self.frames:
            raise RuntimeError(f"No annotated frames under {camera_dir}")

        self._model = None
        self._debouncer = occupancy.Debouncer()
        self._subscribers = []
        self._lock = threading.Lock()
        self._stop = threading.Event()

        self.state = {}
        self.layout = {}
        self.projector = None  # set by run.py, shared with the layout
        self.annotated = None  # most recent JPEG bytes for the MJPEG stream
        self.last_event = None
        self.accuracy = None
        self._correct = 0
        self._scored = 0

        # Vehicle identity is tied to stall occupancy, not frame to frame
        # tracking. PKLot frames are five minutes apart, so a motion tracker
        # like ByteTrack has nothing to associate: a car that left and a
        # different car that arrived look identical to it. A parked car keeps
        # its number for as long as its stall stays occupied, which is both
        # honest and what the activity feed actually wants to say.
        self._vehicle_ids = {}
        self._next_vehicle_id = 1

    def seek(self, time_of_day):
        """Rotate the frame list so replay begins near a given clock time.

        Rotates rather than truncates, so the replay still covers a whole day
        and still loops; it just does not open on an empty pre dawn lot.
        """
        target = time_of_day.strip()
        for index, (jpg, _xml) in enumerate(self.frames):
            captured = pklot.capture_time(jpg)
            if captured and captured.strftime("%H:%M") >= target:
                self.frames = self.frames[index:] + self.frames[:index]
                print(f"replay starts at {captured.strftime('%Y-%m-%d %H:%M')}")
                return
        print(f"no frame at or after {target}, starting from the beginning")

    def subscribe(self, callback):
        with self._lock:
            self._subscribers.append(callback)

    def _publish(self, payload):
        with self._lock:
            subscribers = list(self._subscribers)
        for cb in subscribers:
            try:
                cb(payload)
            except Exception as exc:  # noqa: BLE001
                # A browser closing its tab must never stop the replay, so this
                # catch is deliberately broad. Logged rather than swallowed.
                print(f"subscriber failed: {exc!r}")

    def _load_model(self):
        if self._model is None:
            from ultralytics import YOLO

            self._model = YOLO(MODEL)
        return self._model

    def process_frame(self, jpg, xml):
        """Run one frame end to end. Returns the published state payload."""
        model = self._load_model()
        spaces = pklot.parse_spaces(xml)
        image = cv2.imread(str(jpg))

        result = model.predict(str(jpg), imgsz=IMGSZ, conf=CONF, verbose=False)[0]
        boxes, confs = [], []
        for b in result.boxes:
            if int(b.cls) in VEHICLE_CLASSES:
                boxes.append([float(v) for v in b.xyxy[0]])
                confs.append(float(b.conf))

        matches = occupancy.match_overlap(spaces, boxes, OVERLAP_THRESHOLD)
        raw = {sid: idx is not None for sid, idx in matches.items()}
        state, changes = self._debouncer.update(raw)
        departed = self._update_vehicle_ids(state, changes)

        # Accuracy against the dataset's own labels, running, so the UI can show
        # a measured number rather than a claimed one.
        for s in spaces:
            if s.occupied is not None:
                self._scored += 1
                if state.get(s.id) == s.occupied:
                    self._correct += 1
        self.accuracy = self._correct / self._scored if self._scored else None

        # Use the frame's own capture time, not wall clock. Replaying a day of
        # stills then lays down a real occupancy curve spanning that day, which
        # is the whole point of putting this in a time-series database. Holds
        # stay on wall clock, since those are live interactions.
        captured = pklot.capture_time(jpg) or datetime.now(timezone.utc)

        # Null unless something changed on THIS frame, per contracts/state.schema.json.
        self.last_event = None
        if changes:
            db.record_changes(self.camera_id, captured, changes)
            spot_id, was, became = changes[-1]
            self.last_event = {
                "spot_id": spot_id,
                "from": "occupied" if was else "available",
                "to": "occupied" if became else "available",
                "vehicle_id": (
                    departed.get(spot_id) if not became
                    else self._vehicle_ids.get(spot_id)
                ),
            }

        # Record the level every frame, not just on change. Transitions alone
        # cannot produce a curve, because deltas do not know where the count
        # started. One row per frame is 288 a day.
        occupied_now = sum(1 for v in state.values() if v)
        db.record_level(
            self.camera_id, captured, occupied_now,
            len(state) - occupied_now, len(state),
        )

        holds = db.active_holds(self.camera_id)
        cars = self._project_cars(boxes, matches, state)
        self.annotated = self._annotate(image, spaces, boxes, state, holds)
        self.state = self._payload(captured, spaces, state, holds, confs, cars)
        return self.state

    def _update_vehicle_ids(self, state, changes):
        """Issue a number when a stall fills, retire it when the stall empties.

        Returns the ids of vehicles that just left, so the activity feed can
        name them. They have to be read before the mapping drops them.
        """
        departed = {}
        for spot_id, _was, became in changes:
            if became:
                self._vehicle_ids[spot_id] = self._next_vehicle_id
                self._next_vehicle_id += 1
            else:
                gone = self._vehicle_ids.pop(spot_id, None)
                if gone is not None:
                    departed[spot_id] = gone

        # Seed stalls that were already occupied on the very first frame, which
        # produce no change event but still hold a car worth numbering.
        for spot_id, taken in state.items():
            if taken and spot_id not in self._vehicle_ids:
                self._vehicle_ids[spot_id] = self._next_vehicle_id
                self._next_vehicle_id += 1
        return departed

    def _project_cars(self, boxes, matches, state):
        """Vehicles in monitored stalls, in top-down space, for the twin.

        Only cars sitting in a stall we monitor are published. The camera sees
        the whole lot, so publishing every detection put dozens of stray dots
        across the map with no stall under them, which read as noise rather
        than as data.

        Positions go through the same projector the stalls did. Projecting them
        differently would make vehicles drift off their stalls on the map, which
        looks exactly like a tracking bug and is not one.
        """
        cars = []
        for spot_id, box_idx in matches.items():
            if box_idx is None or not state.get(spot_id):
                continue
            cell = self.layout.get(spot_id)
            if not cell:
                continue
            # Sit the car on the stall it occupies. The map is a uniform
            # schematic, so projecting camera pixels into it independently
            # would place vehicles beside their own stalls.
            x, y = cell["centroid"]
            cars.append({
                "id": self._vehicle_ids.get(spot_id, 0),
                "x": x,
                "y": y,
                "spot_id": spot_id,
            })
        return cars

    def _payload(self, now, spaces, state, holds, confs, cars=None):
        spots = {}
        for s in spaces:
            if s.id in holds:
                spots[s.id] = {
                    "status": "held",
                    "confidence": None,
                    "vehicle_id": None,
                    "held_until": holds[s.id].isoformat(),
                }
            else:
                taken = state.get(s.id, False)
                spots[s.id] = {
                    "status": "occupied" if taken else "available",
                    "confidence": round(max(confs), 2) if taken and confs else None,
                    "vehicle_id": self._vehicle_ids.get(s.id) if taken else None,
                }

        available = [sid for sid, v in spots.items() if v["status"] == "available"]
        best = None
        if available and self.layout:
            best = min(
                available,
                key=lambda sid: self.layout.get(sid, {})
                .get("distance_to_entrance_m", 1e9),
            )
        elif available:
            best = available[0]

        return {
            "camera_id": self.camera_id,
            "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "spots": spots,
            "cars": cars or [],
            "summary": {
                "total": len(spots),
                "occupied": sum(
                    1 for v in spots.values() if v["status"] == "occupied"
                ),
                "available": len(available),
                "accuracy": round(self.accuracy, 3) if self.accuracy else None,
            },
            "best_spot": best,
            "last_event": self.last_event,
        }

    def _annotate(self, image, spaces, boxes, state, holds):
        """Draw the vision panel: stall outlines coloured by state, plus boxes."""
        import numpy as np

        for x1, y1, x2, y2 in boxes:
            cv2.rectangle(
                image, (int(x1), int(y1)), (int(x2), int(y2)), (255, 190, 60), 1
            )

        for s in spaces:
            poly = np.array(s.contour, np.int32).reshape(-1, 1, 2)
            if s.id in holds:
                colour = (0, 190, 255)  # amber, claimed by a driver
            elif state.get(s.id):
                colour = (60, 60, 230)  # red, taken
            else:
                colour = (80, 210, 80)  # green, free
            cv2.polylines(image, [poly], True, colour, 2)

        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else None

    def run(self):
        """Replay frames until stopped. Blocks, so call it on a thread."""
        interval = 1.0 / self.fps
        while not self._stop.is_set():
            for jpg, xml in self.frames:
                if self._stop.is_set():
                    return
                started = time.monotonic()
                try:
                    payload = self.process_frame(jpg, xml)
                    self._publish(payload)
                except Exception as exc:  # noqa: BLE001
                    # One unreadable frame must not end the replay mid demo.
                    print(f"frame {jpg.name} failed: {exc!r}")
                elapsed = time.monotonic() - started
                if elapsed < interval:
                    time.sleep(interval - elapsed)
            if not self.loop:
                return
            # Fresh debouncer each pass, otherwise the wrap from the last frame
            # of one day to the first of the next fires a burst of fake events.
            self._debouncer = occupancy.Debouncer()

    def stop(self):
        self._stop.set()
