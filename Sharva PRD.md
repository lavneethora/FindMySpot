# PRD: Campus Parking Availability System

**Status:** Draft, hackathon MVP
**Owners:** Sharva + teammate

## 1. Summary

A web app that shows students live availability of parking spots on campus, using computer vision on camera footage, and routes them to the nearest open spot. Built to address chronic parking shortage during peak hours, without requiring the university to build new physical parking.

## 2. Problem

Student enrollment has grown faster than parking capacity. During peak hours, students spend significant time circling lots with no reliable way to know which lots or spots are open before they arrive. Building new parking is expensive and often not physically possible on a built out campus. There is no existing system on campus that gives real time visibility into spot availability.

## 3. Goals

- Give a student a live, accurate view of which parking spots are open, before they drive to the lot
- Route the student to the nearest open spot automatically
- Prove the core detection pipeline works reliably enough to be worth pursuing past the hackathon
- Do this without storing or exposing raw camera footage of people

## 4. Non-goals (for this version)

- Campus-wide, multi-lot coverage
- Reservation or payment for a spot
- Native mobile apps (web app only)
- Predictive availability (forecasting when a spot will open)
- Formal integration with the university's actual security camera system

## 5. Users

**Primary: undergraduate/graduate students who drive to campus.** They want to know before they leave, or while en route, whether there's a realistic chance of finding parking near where they're headed.

**Secondary: campus parking services staff.** Not a target user for the hackathon build, but a natural stakeholder for any future version, since they control camera access and lot policy.

## 6. User stories

- As a student, I want to open the app and see which spots in a lot are currently open, so I don't waste time driving to a full lot.
- As a student, I want to be routed to the nearest open spot, so I don't have to manually scan a map and guess.
- As a student, I want the status to be close to real time, so I can trust it enough to actually change my behavior based on it.

## 7. Functional requirements

**7.1 Detection**
- System defines a fixed set of parking spot regions for a given camera's field of view (configured once per camera, not per frame)
- System classifies each defined spot as occupied or empty from each new camera frame
- System updates status at a fixed interval (target: every 1 to 5 seconds)

**7.2 Backend / API**
- Backend stores current status per spot, per lot
- Backend exposes an endpoint returning current status for a lot, or all lots
- Backend timestamps each status update

**7.3 Frontend**
- Map view showing the covered lot with spots marked by current status (open / occupied)
- User can select a destination or use current location, and get a route to the nearest open spot
- Status on screen should visibly refresh as new data comes in, not require a manual reload

**7.4 Privacy**
- Raw video frames are processed and discarded, not stored
- Only detection results (spot ID, status, timestamp) are persisted
- No facial recognition, no license plate recognition, no identification of individuals or vehicles

## 8. Technical requirements

| Layer | Requirement |
|---|---|
| Capture | Camera or recorded video feed of one target lot |
| Detection | Per-spot patch classifier, pretrained on PKLot / CNRPark-EXT, fine-tuned on a small set of labeled frames from the target lot |
| Backend | API serving current occupancy per spot; lightweight database (SQLite acceptable for MVP) |
| Frontend | Web app with map view (Google Maps Platform or Mapbox) and routing to nearest open spot |
| Hosting | Runs locally or on a laptop for demo purposes; cloud hosting not required for MVP |

## 9. Success metrics (for the hackathon demo)

- Detection accuracy on target lot's demo footage: 90%+ (stretch: match published benchmark range of 97 to 99%)
- End to end latency from frame capture to status update shown in app: under 5 seconds
- Live demo runs start to finish without manual intervention

## 10. Scope for this version (MVP) vs. future

**In scope now**
- One camera, one lot
- Binary occupied/empty status per spot
- Web app with map and routing
- Edge or local processing, no stored footage

**Future, not this version**
- Multiple lots, campus-wide coverage
- Partnership with university facilities/IT security for access to existing camera infrastructure
- Predictive/forecasted availability based on historical patterns and class schedules
- Native mobile app
- Spot reservation

## 11. Risks

- Model accuracy may drop outside of clean test conditions: bad angles, shadows, faded lot markings, rain, or night
- No current access to university security camera feeds; MVP must use a demo camera or recorded footage, not real infrastructure
- Reliability matters more than most features here. A system that's wrong sometimes is worse for trust than no system at all

## 12. Open questions

- Which lot will be used for the hackathon demo, and is footage or live camera access available before the event
- Which maps provider the team will standardize on
- Whether the fine-tuning dataset will come from real campus footage or a public dataset lot, if campus footage isn't available in time
