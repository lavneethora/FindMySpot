# Deploying FindMySpot

Three pieces, each hosted separately:

| Piece | Where | Address |
|---|---|---|
| Frontend | Vercel, auto-deploys from `main` | `https://findmyspot.tech` |
| Pipeline | Docker on an Oracle Always Free VM, behind Caddy | `https://api.findmyspot.tech` |
| Database | TimescaleDB on Tiger Cloud | set by `DATABASE_URL` |

Nothing stateful lives on the VM. The database is remote, so the server can be
rebuilt or replaced without losing history.

## Why the pipeline is small

The full PKLot download is 6.6 GB and the dev environment installs torch. A
deployed server needs neither.

Detections for the replayed window are precomputed into `data/cache`, and
`parktech/pipeline.py` only imports YOLO inside `_load_model()`, which runs on a
cache miss. With a complete cache that never happens, so the server needs no
torch, no ultralytics and no GPU. It runs in about **70 MB of RAM**.

If the cache is ever incomplete the server tries to import YOLO and fails
loudly. That is deliberate. Silently falling back to live inference on a small
VM would turn a clear error into a demo that mysteriously crawls.

## Updating the server after a merge

The common case. Vercel redeploys the frontend by itself; the pipeline does not.

```bash
ssh ubuntu@api.findmyspot.tech
cd ~/FindMySpot && git pull
docker build -f deploy/Dockerfile.repo -t findmyspot .
docker rm -f findmyspot
docker run -d --name findmyspot --restart unless-stopped \
  -p 127.0.0.1:8100:8100 --env-file ~/findmyspot.env findmyspot
```

Then run the checks at the bottom of this file.

## Setting up a server from scratch

### 1. The VM

Oracle Cloud, Compute, Create instance:

- **Image:** Canonical Ubuntu 24.04
- **Shape:** Ampere `VM.Standard.A1.Flex`, 1 OCPU, 6 GB. Always Free, and far
  more than the pipeline needs.
- **Networking:** a **public** subnet, with "Assign a public IPv4 address" on.
  If the instance page shows the public IP as `-`, it was not assigned; add an
  ephemeral public IP on the VNIC.
- **SSH key:** paste the contents of your **public** key file (`.pub`), the whole
  line starting `ssh-ed25519`. Oracle does not let you add a key to a VM after it
  is created, and a key protected by a passphrase you do not know is as good as
  no key.

"Out of capacity" is normal for free ARM shapes. Try another Availability
Domain, or retry later.

The VM is ARM and builds its own image, so there is no arm64 versus amd64
mismatch to worry about.

### 2. Open ports 80 and 443, in two places

**In the Oracle console:** the subnet's security list, Add Ingress Rules,
source `0.0.0.0/0`, TCP, destination ports `80,443`.

**On the VM itself.** Oracle's Ubuntu image ships its own firewall, and its
INPUT chain ends in a `REJECT`. Rules are checked top to bottom, so the ACCEPT
rules must go **above** that REJECT. Its position varies between images, so
look it up rather than hardcoding one:

```bash
REJ=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')
sudo iptables -I INPUT $REJ -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT $REJ -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo netfilter-persistent save
sudo iptables -L INPUT -n --line-numbers   # 80 and 443 must sit above REJECT
```

Getting only one of the two right looks exactly the same as getting neither:
port 22 answers and 80 and 443 time out. Check both.

### 3. DNS

In the findmyspot.tech DNS panel:

```
A   api   ->   the VM's public IP
```

Caddy cannot get a certificate until this resolves.

### 4. Docker and the app

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu   # log out and back in

git clone https://github.com/lavneethora/FindMySpot.git ~/FindMySpot
cd ~/FindMySpot
docker build -f deploy/Dockerfile.repo -t findmyspot .
```

The repo carries the 400 replayed frames and the detection cache, so no bundle
step is needed.

Secrets go in an env file readable only by you, never on the command line where
they end up in shell history:

```bash
umask 077
cat > ~/findmyspot.env <<'EOF'
DATABASE_URL=postgres://...your Tiger Cloud connection string...
ALLOWED_ORIGINS=https://findmyspot.tech,https://findmyspot-three.vercel.app
EOF
```

```bash
docker run -d --name findmyspot --restart unless-stopped \
  -p 127.0.0.1:8100:8100 --env-file ~/findmyspot.env findmyspot
```

`-p 127.0.0.1:8100:8100` rather than `-p 8100:8100` is deliberate: the app is
reachable only through Caddy, over HTTPS. `--restart unless-stopped` brings it
back after a crash or a reboot with nobody watching.

`ALLOWED_ORIGINS` lists the vercel.app address as well as the custom domain, so
a problem with the domain's DNS or certificate does not also break the fallback
URL.

### 5. TLS with Caddy

A browser will not let an HTTPS page talk to a plain HTTP backend, and it
refuses quietly: the map loads and then sits there dead. So the pipeline needs a
real certificate, and Caddy gets and renews one on its own.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
api.findmyspot.tech {
    reverse_proxy localhost:8100
}
```

```bash
sudo systemctl reload caddy
```

Caddy proxies WebSocket upgrades with no extra config. If certificate attempts
failed while the ports were still closed, Caddy backs off before retrying;
`sudo systemctl restart caddy` makes it try again immediately.

### 6. The frontend

Nothing to run by hand. `web/.env.production` sets
`VITE_API_BASE=https://api.findmyspot.tech`, and Vercel builds from `main` on
every push. The value is baked in at build time: unset, the frontend uses
relative paths, which resolve against the static host and return 404s.

## Checks

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.findmyspot.tech/api/state
curl -s -D- -o /dev/null -H "Origin: https://findmyspot.tech" \
  https://api.findmyspot.tech/api/state | grep -i access-control-allow-origin
```

A 200 on the first and the right origin echoed on the second mean the two
halves can talk.

**Then open the site and watch the map for thirty seconds.** A proxy that
forwards HTTP but not WebSocket upgrades passes both checks above while the map
stays frozen on its first frame. Stalls changing colour on their own is the
only check that proves `wss://` works.

## Bandwidth

The operator view's camera panel is an MJPEG stream from `/video`, and it is by
far the heaviest thing the server sends. At full replay speed it is about
0.5 GB an hour for each open operator tab, background tabs included. It
previously ran several times heavier and used up a free tier's monthly
allowance within days; see PR #52. Oracle's Always Free egress is generous, but
it is worth remembering before moving the pipeline to a host with a small
bandwidth cap.

## Oracle's idle policy

Oracle may reclaim Always Free VMs it considers idle, judged on low CPU,
network and memory use over a week. This pipeline is light enough to look idle.
Upgrading the account to Pay As You Go generally exempts it while Always Free
resources stay free; check Oracle's current terms, and set a small budget alert.

## Without Docker

Docker is convenient, not required. The pipeline is a plain Python application:

```bash
cd ~/FindMySpot
python3 -m venv venv
./venv/bin/pip install -r deploy/requirements-server.txt
set -a; . ~/findmyspot.env; set +a
./venv/bin/python run.py --host 127.0.0.1 --port 8100 --start 11:30
```

Run it under systemd so it survives a logout:

```ini
# /etc/systemd/system/findmyspot.service
[Unit]
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/FindMySpot
EnvironmentFile=/home/ubuntu/findmyspot.env
ExecStart=/home/ubuntu/FindMySpot/venv/bin/python run.py --host 127.0.0.1 --port 8100 --start 11:30
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now findmyspot
journalctl -u findmyspot -f
```

## Building from a bundle instead

For a host where cloning the repo is not an option, `scripts/make_bundle.py`
carves out just what the server needs (the package, config, contracts, the
cache and only the frames the cache covers) and `deploy/Dockerfile` builds from
that layout:

```bash
python scripts/make_bundle.py --out ../findmyspot-bundle
# copy ../findmyspot-bundle to the server, then in it:
docker build -t findmyspot .
```

## Rolling back the database

The pipeline reads `DATABASE_URL` from the environment first, then `.env`, then
localhost. Unset it and everything runs against a local container again, with
no code change.
