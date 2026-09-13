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

## 2. Run it

```bash
cd ../findmyspot-bundle
docker build -t findmyspot-pipeline .
docker run -d --name findmyspot -p 8100:8100 \
  -e DATABASE_URL="postgres://...tsdb.cloud.timescale.com:.../tsdb?sslmode=require" \
  -e ALLOWED_ORIGINS="https://your-frontend-domain" \
  findmyspot-pipeline
```

`DATABASE_URL` is required and has no default in the image. There is no
database in the container on purpose: one that loses its data on every redeploy
is worse than none.

## 3. Put TLS in front of it

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

## 4. Deploy the frontend

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

## Rolling back

The pipeline reads `DATABASE_URL` from the environment first, then `.env`, then
localhost. Unset it and everything runs against a local container again, with
no code change.
