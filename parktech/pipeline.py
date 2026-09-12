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

# Validated on UFPR04: 97.9% per-stall accuracy, zero false positives.
# See scripts/accuracy.py and the PRD before changing any of these.
MODEL = "yolo11s.pt"
IMGSZ = 1280
CONF = 0.2
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
        self.annotated = None  # most recent JPEG bytes for the MJPEG stream
        self.last_event = None
        self.accuracy = None
        self._correct = 0
        self._scored = 0

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

        raw = occupancy.assign_overlap(spaces, boxes, OVERLAP_THRESHOLD)
        state, changes = self._debouncer.update(raw)

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
            }

        holds = db.active_holds(self.camera_id)
        self.annotated = self._annotate(image, spaces, boxes, state, holds)
        self.state = self._payload(captured, spaces, state, holds, confs)
        return self.state

    def _payload(self, now, spaces, state, holds, confs):
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
                    "vehicle_id": None,
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
            "cars": [],  # populated once the homography lands
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
