"""Live vision round-trip for image-evidence appeals.

Direct-mode tests prove the wiring (fetch -> magic-byte check -> attach -> decide
-> settle) but the local LLM mock ignores the image, so they never prove a real
validator actually fetches the CID and a vision model reads it. This test does,
end to end, against a real GenLayer network.

It is marked `slow` (excluded from the default run) because it makes several real
LLM calls and one real IPFS fetch, so it can take minutes and is rate-limited on
StudioNet.

Run it:
    INTEGRATION_EVIDENCE_CID=<a pinned image cid> \
        .venv/bin/gltest tests/integration/test_appeal_vision_live.py -m slow -v -s --network studionet

Pin an image and get its CID with deploy/pin-evidence.mjs (needs a PINATA_JWT).
If INTEGRATION_EVIDENCE_CID is unset, or the gateway doesn't serve a usable
image for it, the test skips rather than fails, so a dead pin never looks like a
contract bug.
"""

import os

import pytest
import requests

from gltest import get_contract_factory, get_default_account, create_accounts
from gltest.assertions import tx_execution_succeeded

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
GATEWAY = "https://ipfs.io/ipfs/"
EVIDENCE_CID = os.environ.get("INTEGRATION_EVIDENCE_CID", "").strip()

_IMAGE_MAGICS = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")


def _gateway_serves_image(cid: str) -> bool:
    """Pre-flight: skip (not fail) if the CID isn't reachable as an image."""
    try:
        resp = requests.get(GATEWAY + cid, timeout=30)
    except requests.RequestException:
        return False
    body = resp.content or b""
    if resp.status_code != 200 or not body:
        return False
    if any(body.startswith(magic) for magic in _IMAGE_MAGICS):
        return True
    return len(body) >= 12 and body[0:4] == b"RIFF" and body[8:12] == b"WEBP"


def _field(room, name):
    """get_room returns the room dataclass; decode is dict- or attr-shaped."""
    if isinstance(room, dict):
        return room[name]
    return getattr(room, name)


@pytest.mark.slow
def test_appeal_with_image_evidence_judges_live():
    if not EVIDENCE_CID:
        pytest.skip("set INTEGRATION_EVIDENCE_CID to a pinned image CID to run this")
    if not _gateway_serves_image(EVIDENCE_CID):
        pytest.skip(f"gateway did not serve a usable image for {EVIDENCE_CID}")

    factory = get_contract_factory("ArgueGame")
    alice = get_default_account()           # deployer / provisional winner
    bob = create_accounts(1)[0]             # opponent / provisional loser

    # window=3600 so the appeal can be filed inside an open challenge window.
    contract = factory.deploy(args=[ZERO_ADDRESS, False, 3600], account=alice)

    assert tx_execution_succeeded(contract.register_profile(args=["AliceLive"]).transact())
    assert tx_execution_succeeded(
        contract.create_room(args=["VISLIVE", "Tech", ZERO_ADDRESS, "debate", 0]).transact()
    )

    as_bob = contract.connect(bob)
    assert tx_execution_succeeded(as_bob.register_profile(args=["BobLive"]).transact())
    assert tx_execution_succeeded(as_bob.join_room(args=["VISLIVE", ZERO_ADDRESS]).transact())
    # Bob quits -> Alice is provisional winner, Bob is the loser who may appeal.
    assert tx_execution_succeeded(as_bob.forfeit_room(args=["VISLIVE"]).transact())

    assert tx_execution_succeeded(
        as_bob.file_appeal(
            args=["VISLIVE", "Screenshot shows the disconnect dialog that cost me the round.", EVIDENCE_CID]
        ).transact()
    )

    # The real round-trip: a validator fetches the CID and a vision model judges it.
    judged = contract.judge_appeal(args=["VISLIVE"]).transact()
    assert tx_execution_succeeded(judged)

    room = contract.get_room(args=["VISLIVE"]).call()
    # We can't assert a specific verdict from a live model, only that the
    # consensus path completed and produced a valid, recorded decision.
    assert _field(room, "appeal_state") == "judged"
    assert _field(room, "appeal_result") in ("upheld", "overturned")
    assert "Appeal:" in _field(room, "verdict_reasoning")
