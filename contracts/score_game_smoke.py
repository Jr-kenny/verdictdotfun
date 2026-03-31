# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")


@gl.contract_interface
class ScoreCoreSmoke:
    class Write:
        def apply_match_result(self, player: Address, match_id: str, did_win: bool, mode: str, /) -> None: ...


class ScoreGameSmoke(gl.Contract):
    owner: Address
    score_core: Address

    def __init__(self, score_core: typing.Any = ZERO_ADDRESS):
        self.owner = gl.message.sender_address
        self.score_core = self._normalize_address(score_core)

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def set_score_core(self, score_core: Address):
        self._require_owner()
        self.score_core = self._normalize_address(score_core)

    @gl.public.write
    def report_match(self, match_id: str, winner: Address, loser: Address, mode: str = "argue"):
        if self.score_core == ZERO_ADDRESS:
            raise Exception("Score core is not configured.")

        normalized_match_id = match_id.strip().upper()
        if not normalized_match_id:
            raise Exception("Match id is required.")

        core = ScoreCoreSmoke(self.score_core)
        core.emit(on="accepted").apply_match_result(self._normalize_address(winner), normalized_match_id, True, mode)
        core.emit(on="accepted").apply_match_result(self._normalize_address(loser), normalized_match_id, False, mode)

    @gl.public.view
    def get_self_address(self) -> Address:
        return gl.message.contract_address

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        return Address(str(value))

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")
