"""Point the pipeline at Tiger Cloud, and prove it actually works.

    python scripts/use_tiger_cloud.py "postgresql://tsdbadmin:...@....tsdb.cloud.timescale.com:.../tsdb?sslmode=require"

Writes the connection string to .env, which is gitignored, and never to a
tracked file. Then creates the schema and reads it back, because a connection
string that parses is not the same as a database that works: the extension has
to be installable, hypertables have to be creatable, and continuous aggregate
policies have to be permitted. Managed hosts differ on all three, and finding
out at the demo is the wrong time.

Falling back is one line: comment out DATABASE_URL in .env, or

    unset DATABASE_URL

and the local Docker container takes over again.
"""

import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

ENV = REPO / ".env"


def write_env(url):
    """Store it in .env, replacing any DATABASE_URL already there."""
    lines = []
    if ENV.exists():
        lines = [
            line for line in ENV.read_text().splitlines()
            if not line.startswith("DATABASE_URL=")
        ]
    lines.append(f"DATABASE_URL={url}")
    ENV.write_text("\n".join(lines) + "\n")


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    url = sys.argv[1].strip().strip('"').strip("'")
    if not url.startswith("postgres"):
        print(f"That does not look like a connection string: {url[:40]}...")
        return 1

    import os

    os.environ["DATABASE_URL"] = url

    from parktech import db

    # Show where we are pointing without printing the password.
    host = url.split("@")[-1].split("/")[0] if "@" in url else "?"
    print(f"host: {host}")

    print("creating schema...")
    db.init()

    with db.connect() as conn:
        version = conn.execute(
            "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
        ).fetchone()
        if not version:
            print("FAIL: timescaledb extension is not installed and could not be created.")
            print("This host cannot run the project as built. Keep the local container.")
            return 1
        print(f"timescaledb: {version[0]}")

        tables = [
            r[0] for r in conn.execute(
                "SELECT hypertable_name FROM timescaledb_information.hypertables"
            ).fetchall()
        ]
        aggs = [
            r[0] for r in conn.execute(
                "SELECT view_name FROM timescaledb_information.continuous_aggregates"
            ).fetchall()
        ]
        print(f"hypertables: {tables}")
        print(f"aggregates : {aggs}")

    missing = {"parking_events", "occupancy_levels"} - set(tables)
    if missing or len(aggs) < 2:
        print(f"FAIL: incomplete schema. missing tables {missing}, {len(aggs)} aggregates.")
        return 1

    write_env(url)
    print(f"\nwrote DATABASE_URL to {ENV.name} (gitignored)")
    print("run.py will use Tiger Cloud from now on.")
    print("The history starts empty, so replay for a few minutes before")
    print("anyone looks at the occupancy chart.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
