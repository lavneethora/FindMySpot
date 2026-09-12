"""Time-series storage for parking occupancy.

Occupancy is sensor data: a stream of state changes per stall over time. That is
what TimescaleDB is for, and it is what lets the analytics view answer questions
a current-state table cannot (when does this lot peak, how fast do stalls turn
over, how long until something frees up).

Two deliberate choices:

1. **Only state changes are written, never a row per frame.** A frame every five
   minutes across 28 stalls would be 8k rows a day of mostly identical values.
   Changes are perhaps a few hundred, and every question we care about is
   answerable from them.

2. **A continuous aggregate does the bucketing**, not the frontend. Occupancy
   over time is a materialised rollup that Timescale keeps current, so the chart
   query stays cheap no matter how much history accumulates.

Set DATABASE_URL to point at Tiger Cloud instead of the local container. Nothing
else changes.
"""

import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import psycopg

DEFAULT_URL = "postgresql://parktech:parktech@localhost:5432/parktech"

# How long a driver's claim on a stall survives without a car arriving.
HOLD_SECONDS = 90


def url():
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


@contextmanager
def connect():
    with psycopg.connect(url(), autocommit=True) as conn:
        yield conn


SCHEMA = """
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS parking_events (
    time        TIMESTAMPTZ      NOT NULL,
    camera_id   TEXT             NOT NULL,
    spot_id     TEXT             NOT NULL,
    status      TEXT             NOT NULL,
    confidence  REAL,
    vehicle_id  INTEGER
);

SELECT create_hypertable('parking_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS parking_events_spot_time
    ON parking_events (camera_id, spot_id, time DESC);

CREATE TABLE IF NOT EXISTS spot_holds (
    spot_id     TEXT        NOT NULL,
    camera_id   TEXT        NOT NULL,
    session_id  TEXT        NOT NULL,
    held_until  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (camera_id, spot_id)
);
"""

# Separate because a continuous aggregate cannot be created inside a transaction
# block alongside the rest, and CREATE MATERIALIZED VIEW has no IF NOT EXISTS in
# every version we might hit.
CONTINUOUS_AGGREGATE = """
CREATE MATERIALIZED VIEW occupancy_5min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    camera_id,
    count(*) FILTER (WHERE status = 'occupied') AS became_occupied,
    count(*) FILTER (WHERE status = 'available') AS became_available
FROM parking_events
GROUP BY bucket, camera_id
WITH NO DATA;
"""


def init():
    """Create the schema. Safe to run repeatedly."""
    with connect() as conn:
        conn.execute(SCHEMA)
        existing = conn.execute(
            "SELECT 1 FROM timescaledb_information.continuous_aggregates "
            "WHERE view_name = 'occupancy_5min'"
        ).fetchone()
        if not existing:
            conn.execute(CONTINUOUS_AGGREGATE)
            # start_offset must be NULL, not a window like '1 day'. Events carry
            # the frame's capture time, which for PKLot is 2013, so any bounded
            # lookback would never cover the data and the chart would stay empty.
            conn.execute(
                "SELECT add_continuous_aggregate_policy('occupancy_5min', "
                "start_offset => NULL, "
                "end_offset => INTERVAL '1 minute', "
                "schedule_interval => INTERVAL '1 minute')"
            )


def refresh_analytics():
    """Materialise the aggregate now rather than waiting for the policy.

    The background job runs on a schedule, which is too slow when a demo has
    just replayed a day of history and someone is about to look at the chart.
    """
    with connect() as conn:
        conn.execute("CALL refresh_continuous_aggregate('occupancy_5min', NULL, NULL)")


def record_changes(camera_id, when, changes, confidences=None):
    """Write one row per stall that actually changed state.

    changes: iterable of (spot_id, was, now) as produced by the Debouncer.
    """
    confidences = confidences or {}
    rows = [
        (when, camera_id, spot_id, "occupied" if now else "available",
         confidences.get(spot_id))
        for spot_id, _was, now in changes
    ]
    if not rows:
        return 0
    with connect() as conn, conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO parking_events "
            "(time, camera_id, spot_id, status, confidence) "
            "VALUES (%s, %s, %s, %s, %s)",
            rows,
        )
    return len(rows)


def place_hold(camera_id, spot_id, session_id, seconds=HOLD_SECONDS):
    """Claim a stall for one driver. Returns when the claim expires.

    Upsert on (camera_id, spot_id) so a stall can only ever be held by one
    session. This is what stops two drivers being sent to the same place.
    """
    until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    with connect() as conn:
        conn.execute(
            "INSERT INTO spot_holds (camera_id, spot_id, session_id, held_until) "
            "VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (camera_id, spot_id) DO UPDATE "
            "SET session_id = EXCLUDED.session_id, held_until = EXCLUDED.held_until "
            "WHERE spot_holds.held_until < now()",
            (camera_id, spot_id, session_id, until),
        )
        row = conn.execute(
            "SELECT session_id, held_until FROM spot_holds "
            "WHERE camera_id = %s AND spot_id = %s",
            (camera_id, spot_id),
        ).fetchone()
    # If someone else already holds it, the upsert was refused and the row still
    # names them. Tell the caller rather than pretending the claim succeeded.
    if row and row[0] != session_id:
        return None
    return row[1] if row else None


def active_holds(camera_id):
    """spot_id -> expiry, for holds that have not run out."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT spot_id, held_until FROM spot_holds "
            "WHERE camera_id = %s AND held_until > now()",
            (camera_id,),
        ).fetchall()
    return {spot_id: until for spot_id, until in rows}


def release_hold(camera_id, spot_id):
    with connect() as conn:
        conn.execute(
            "DELETE FROM spot_holds WHERE camera_id = %s AND spot_id = %s",
            (camera_id, spot_id),
        )


def occupancy_history(camera_id, hours=24):
    """Rows for the analytics chart, straight off the continuous aggregate."""
    with connect() as conn:
        return conn.execute(
            "SELECT bucket, became_occupied, became_available "
            "FROM occupancy_5min WHERE camera_id = %s "
            "AND bucket > now() - %s::interval ORDER BY bucket",
            (camera_id, f"{hours} hours"),
        ).fetchall()


def recent_events(camera_id, limit=20):
    """Most recent state changes, for the activity feed."""
    with connect() as conn:
        return conn.execute(
            "SELECT time, spot_id, status FROM parking_events "
            "WHERE camera_id = %s ORDER BY time DESC LIMIT %s",
            (camera_id, limit),
        ).fetchall()
