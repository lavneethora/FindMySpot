# Deploying FindMySpot

Two halves, deployed separately: a static frontend, and a Python pipeline that
replays precomputed detections. The database is already remote (Tiger Cloud),
so nothing stateful runs on the box.

## Why the pipeline is small

The full PKLot download is 6.6 GB and the dev environment installs torch. A
deployed demo needs neither.

Detections for the replayed window are precomputed into `data/cache`, and
`parktech/pipeline.py` only imports YOLO inside `_load_model()`, which runs on a
cache miss. With a complete cache that never happens, so the server needs no
torch, no ultralytics and no GPU.

Measured: **155 MB of bundle, 209 MB of dependencies.**

If the cache is ever incomplete the server tries to import YOLO and fails
loudly. That is deliberate. Silently falling back to live inference on a small
VM would turn a clear error into a demo that mysteriously crawls.

## 1. Build the bundle

```bash
python scripts/make_bundle.py --out ../findmyspot-bundle
```

Copies the package, `run.py`, config, contracts, the cache, and only the frames
the cache covers. Frames are chosen from the cache rather than by count, so the
two cannot disagree.

## 2. Copy it to the server

```bash
rsync -az --info=progress2 ../findmyspot-bundle/ root@YOUR_VM_IP:/opt/findmyspot/
```

155 MB, so a couple of minutes on a normal connection.

## 3. Build on the server, not on your laptop

An Apple Silicon Mac builds arm64 images. A cloud VM is almost always amd64,
and an arm64 image on an amd64 host either refuses to start or runs under
emulation at a speed that ruins the demo. Building on the box it runs on avoids
the question entirely, and the build is only a pip install.

```bash
ssh root@YOUR_VM_IP
cd /opt/findmyspot
docker build -t findmyspot-pipeline .
docker run -d --name findmyspot --restart unless-stopped -p 8100:8100 \
  -e DATABASE_URL="postgres://...tsdb.cloud.timescale.com:.../tsdb?sslmode=require" \
  -e ALLOWED_ORIGINS="https://your-frontend-domain" \
  findmyspot-pipeline
```

`--restart unless-stopped` matters more than it looks: it brings the pipeline
back after a reboot or a crash without anyone noticing, which is worth having
when the machine is unattended overnight.

If you must build on the Mac, pass `--platform linux/amd64` and expect it to be
slow.

The image comes out at **839 MB**, most of which is the Python base and
opencv. That is another reason to build on the VM rather than pushing an image
around: the bundle you rsync is 155 MB, and the rest is assembled on the box
from pip.

`DATABASE_URL` is required and has no default in the image. There is no
database in the container on purpose: one that loses its data on every redeploy
is worse than none.

## 4. Put TLS in front of it

**This is the step that eats the time, so do it before anything else.**

The frontend will be served over HTTPS. A browser refuses to let an HTTPS page
talk to a plain HTTP backend, and it refuses quietly: the map loads, then sits
there dead, with the reason buried in the console. It reads exactly like a bug
in the app and is not one.

So the pipeline needs a real certificate, which needs a domain pointed at the
box. With `findmyspot.tech` pointed at the server, Caddy does the rest:

```bash
# /etc/caddy/Caddyfile
api.findmyspot.tech {
    reverse_proxy localhost:8100
}
```

Caddy obtains and renews the certificate automatically. Without a domain you
are hand-rolling self-signed certificates and adding browser exceptions, which
does not work for a judge opening the link on their phone.

## 5. Deploy the frontend

```bash
cd web
VITE_API_BASE="https://api.findmyspot.tech" VITE_USE_MOCK=0 npm run build
vercel deploy --prod
```

`VITE_API_BASE` is baked in at build time. Without it the frontend uses relative
paths, which work in development through Vite's proxy and resolve against the
static host in production, returning 404s.

Then set `ALLOWED_ORIGINS` on the pipeline to the frontend's real origin and
restart it.

## Checks that catch the common failures

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.findmyspot.tech/api/state
curl -s -D- -o /dev/null -H "Origin: https://findmyspot.tech" \
  https://api.findmyspot.tech/api/state | grep -i access-control-allow-origin
```

A 200 on the first and the right origin echoed on the second means the two
halves can talk. If the map still does not update after that, open the console
and look for a blocked WebSocket: `wss://` has to reach the pipeline too, and a
proxy that forwards HTTP but not upgrades will pass every test above while the
map stays frozen on its first frame.

## If Docker fights you

Docker is convenient, not required. The bundle is a plain Python application
and this path is the one that was actually verified end to end on a clean
machine with neither torch nor ultralytics installed:

```bash
cd /opt/findmyspot
python3 -m venv venv
./venv/bin/pip install -r requirements-server.txt
DATABASE_URL="postgres://..." ALLOWED_ORIGINS="https://your-frontend-domain" \
  ./venv/bin/python run.py --host 0.0.0.0 --port 8100 --start 11:30
```

Measured at 209 MB of dependencies. Put it under systemd so it survives a
logout, which an ssh session with a backgrounded process does not:

```ini
# /etc/systemd/system/findmyspot.service
[Unit]
After=network.target

[Service]
WorkingDirectory=/opt/findmyspot
Environment=DATABASE_URL=postgres://...
Environment=ALLOWED_ORIGINS=https://your-frontend-domain
ExecStart=/opt/findmyspot/venv/bin/python run.py --host 0.0.0.0 --port 8100 --start 11:30
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now findmyspot
journalctl -u findmyspot -f
```

## Rolling back

The pipeline reads `DATABASE_URL` from the environment first, then `.env`, then
localhost. Unset it and everything runs against a local container again, with
no code change.
