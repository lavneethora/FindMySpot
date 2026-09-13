# A pipeline that replays precomputed detections. No torch, no GPU.
#
# Built from a bundle produced by scripts/make_bundle.py, not from the repo:
# the repo carries 6.6 GB of dataset and a venv, and a deployed demo replays a
# few hundred frames whose detections are already computed.

FROM python:3.12-slim

# opencv-python-headless still needs libGL and glib at runtime even without a
# display. Without these the import fails at startup with an error that reads
# like a missing Python package and is not one.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Requirements first, so a code change does not reinstall the dependency layer.
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY . .

# Bind to every interface. Inside a container 127.0.0.1 is reachable only from
# the container itself, so a server bound there answers nothing from outside.
ENV HOST=0.0.0.0
ENV PORT=8100
EXPOSE 8100

# DATABASE_URL must be set at run time and point at Tiger Cloud. There is no
# database in this image on purpose: a container that loses its data on every
# redeploy is worse than no database at all.
#
# ALLOWED_ORIGINS should name the frontend's origin once deployed.
CMD ["sh", "-c", "python run.py --host $HOST --port $PORT --start 11:30"]
