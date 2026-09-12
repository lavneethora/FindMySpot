"""Validate the mock fixtures against the contract schemas.

Run by CI on every PR, and worth running locally before you push a contract change.
The point is to catch an interface drift the moment it happens, rather than at the
integration sync when both lanes have already built on top of it.

    python scripts/validate_contracts.py
"""

import json
import pathlib
import sys

from jsonschema import Draft7Validator

CONTRACTS = pathlib.Path(__file__).resolve().parent.parent / "contracts"


def load(name):
    return json.loads((CONTRACTS / name).read_text())


def main():
    state_validator = Draft7Validator(load("state.schema.json"))
    layout_validator = Draft7Validator(load("layout.schema.json"))

    layout = load("mock_layout.json")
    state = load("mock_state.json")
    sequence = load("mock_sequence.json")

    failures = []

    for error in layout_validator.iter_errors(layout):
        failures.append(f"mock_layout.json: {error.message}")

    for error in state_validator.iter_errors(state):
        failures.append(f"mock_state.json: {error.message}")

    for i, frame in enumerate(sequence):
        for error in state_validator.iter_errors(frame):
            failures.append(f"mock_sequence.json[{i}]: {error.message}")

    # Spot ids must line up across layout and state, or the frontend renders
    # stalls it has no geometry for and silently drops them.
    layout_ids = set(layout["spots"])
    state_ids = set(state["spots"])
    if layout_ids != state_ids:
        failures.append(f"spot id mismatch between layout and state: {layout_ids ^ state_ids}")

    for i, frame in enumerate(sequence):
        if set(frame["spots"]) != layout_ids:
            failures.append(f"mock_sequence.json[{i}]: spot ids do not match the layout")

    # The demo hinges on one visible transition, so assert it is actually in the fixture.
    transitions = [f["last_event"] for f in sequence if f.get("last_event")]
    if not transitions:
        failures.append("mock_sequence.json: no last_event anywhere, the demo moment is missing")

    if failures:
        print("\n".join(failures))
        return 1

    print(f"contracts ok: {len(layout_ids)} spots, {len(sequence)} frames, "
          f"{len(transitions)} transition(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
