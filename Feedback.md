# Feedback for the GenLayer team

hey, wrote this down while building verdictdotfun so it's actual build feedback and not
vibes. the project is a multi-game wager platform where the contract is the judge, not just
storage, and the piece i just shipped is the wager + verdict framework: an escrow ledger, a
generic mode registry, and two-phase settlement where a losing player can appeal and the
contract itself decides upheld or overturned with an LLM.

short version: the core idea is great and the llm-as-judge stuff is the whole reason we're on
genlayer. most of the pain was in the dev/test loop and a few sharp bits that cost real hours.

## what's genuinely good

the contract-as-judge model delivers. our appeal flow, where the loser disputes a result and
the contract reads the evidence and renders a verdict with reasoning, is something you can't do
cleanly on a normal chain. that's the thing worth selling. the custom validator pattern
(`gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` where you only compare the binding field) is
powerful once it clicks, being able to say "validators must agree on `decision` but the reasoning
text can differ between them" is exactly the right level of control. gltest direct mode is fast,
30 to 50ms with no docker, so the inner loop on business logic was great. genvm-lint actually
loading the contract and validating it caught real bugs before deploy, and the cross-chain
`eth_call` verification pattern (`gl.nondet.web.post` into `eth_call` checked with `strict_eq`)
is a really nice primitive, it means the contract can verify an EVM deposit itself instead of
trusting a relayer. that one's underrated, worth making louder in the docs.

## the stuff that cost us hours

the biggest one is that direct mode can't run multiple deployed contracts in one test. our whole
architecture is cross-contract, core registry calls a mode contract which calls the ledger, and
direct mode uses one in-memory root so any test wiring two contracts together is basically
`xfail`. we ended up guarding every cross-contract call so it no-ops when the address is zero,
just so each contract stays unit-testable on its own, and pushed all the real wiring into
integration tests. that's a real design tax. either support multi-contract direct mode, or at
least say plainly in the docs "design your contracts so cross-contract calls no-op on a zero
address", because we worked that out the hard way.

second, you can't advance the clock in direct mode. `direct_vm.warp(...)` sets the vm datetime,
but inside the contract `gl.message_raw["datetime"]` stays frozen and doesn't reflect the warp,
even though `sender_address` updates fine per call. we have a one hour challenge window enforced
on-chain off the datetime, and we literally couldn't test the "window elapsed, finalize allowed"
path through time travel. we worked around it by making the window a constructor param, so a zero
length window exercises the allowed branch and the default exercises the blocked branch. it works
but it's a workaround for a testing gap. either make warp propagate to the contract's view of
time, or document that it doesn't.

third, `gl.message.datetime` doesn't exist, it's `gl.message_raw["datetime"]`. lost a chunk of
time to `AttributeError: 'MessageType' object has no attribute 'datetime'`. `gl.message` is a
namedtuple with only contract, sender, origin, value, chain_id on it, and the datetime lives on
the raw dict as a string. either surface it on `gl.message` like the other fields, or put one
clear line in the docs.

fourth, setting the sender to a raw hex string silently breaks TreeMap lookups. in tests,
`direct_vm.sender = "0xabc..."` made `approved_callers.get(sender)` blow up deep inside the tree
with `assert isinstance(r, Address)` on `__gt__`. the fix was to use a real Address fixture as the
sender, but the error points at tree_map internals, not at "your sender isn't an Address". coerce
strings to Address at the cheatcode boundary, or raise something readable.

fifth, small one, `from genlayer import *` doesn't bring in `dataclass`. `@allow_storage
@dataclass` fails with `name 'dataclass' is not defined` until you also add `from dataclasses
import dataclass`, and the skeleton examples don't always show that import.

and last, bare `Exception` turning into an unrecoverable VMError is an easy mistake to make. fair
that you want `gl.vm.UserError` and the linter warns about it, but the hackathon codebase we
inherited was full of bare `raise Exception(...)` and it "worked" right up until it didn't. worth
making that warning louder, or a doc note that bare exceptions are genuinely dangerous in
production and not just a style thing.

## smaller notes

the runner version pinning rejecting `test` and `latest` on networks is correct, but for a
newcomer the failure is confusing, a one line error like "networks require a pinned runner hash,
see <link>" would save people. more end-to-end examples of the factory plus registry pattern
(deploy children, call back into core) would help, it's a common shape and the direct-mode limits
make it easy to get wrong. and `jsonSafeReturn: true` on `client.readContract` is great for
getting plain json back, worth making it more prominent.

## context

built with single-file `py-genlayer` contracts, gltest direct mode and genvm-lint, base sepolia
for the EVM side, and genlayer-js for the relayer/bridge. the framework that generated all this:
an EVM credit vault talking to a genlayer credit ledger, with two-phase settlement (provisional,
then a one hour appeal window, then finalize) where the appeal is judged by the contract. the
appeal-judging contract is a nice stress test of the consensus-on-subjective-output path if you
ever want a repro. thanks for building something that makes "the contract is the brain" actually
work.
