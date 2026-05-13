# Bookmarked: swarm cognition

Parked during planning of the single-nanobot temporal-thinking simulation.
Recorded here so we don't lose it.

## The idea

A volume of nanobots (e.g. 25×25×25 ≈ 15,625) moves in formation through
the world, systematically sweeping for chemical sources. Bots are spaced
far enough apart that the volume they cover is meaningful. When some
fraction of the swarm encounters significant concentration, the rest of
the swarm migrates toward that signal, still maintaining inter-bot
spacing, so the swarm effectively *becomes a moving sensing volume* that
tracks a plume back to its source. On arrival the swarm converges and
neutralizes the source (mechanism TBD — possibly a chemical payload that
breaks down the source material).

## Why this is interesting

Swarm cognition trades **time for space** relative to a single bot:

- A single bot can only know about places it *has been recently*. To
  estimate a gradient it must move and remember. Temporal thinking is
  essential.
- A swarm can know about all the places its members *currently are*. The
  gradient is readable in one tick from the swarm's spatial extent. The
  spatial coverage substitutes for memory.

A swarm with no individual memory still does something powerful:
instantaneous 3D sampling of the smell field. A swarm with individual
memory *and* communication can reconstruct a 4D dataset (each member
contributes its trajectory of (position, time, concentration) tuples), so
in principle the swarm could reason about the *source's dynamics* — which
is exactly the temporal/4D reasoning we care about.

## Why this is bookmarked, not pursued now

- Single-bot is the harder cognitive problem. Forced to think with time
  because it has no spatial coverage. That's the cleanest pressure for
  the cognitive architecture we want to design.
- A swarm tends to solve cognitive problems by adding bots. If we start
  with a swarm we'll be tempted to keep adding members whenever
  cognition gets hard. Less interesting research path.
- After we know what a single bot's temporal cognition looks like, "a
  swarm of *those* bots" becomes a real and well-posed question.

## Possible later moves

- Swarm of dumb bots, no comms, each running chemotaxis independently.
  Baseline coordination from physics alone (drift toward higher
  concentration neighbors).
- Add comms: members broadcast their (position, concentration) to
  neighbors. The swarm's collective belief is now a distributed dataset.
- Single shared-belief swarm: one inferred source-position estimate,
  updated by all members. Tests whether collective inference outperforms
  N independent inferences.
- "Swarm-of-minds": each bot has the temporal cognition we developed for
  the single-bot case, *and* shares its belief. Tests how individual
  cognition and collective cognition compose.

## The brain question, briefly

Anton's intuition was that the swarm picture might resemble how brains
work — many parallel processes rather than a serial reasoner. Distinct
levels worth being honest about:

1. Parallelism of mechanism (neurons firing simultaneously). True.
2. Parallelism of cognition (many distinct hypotheses running at once).
   Probably true, messy. Most parallel processes are sub-personal.
3. Parallelism of agency (many local agents whose aggregate produces
   coherent goal-directed behavior). Speculative; related to Minsky
   society-of-mind, Dennett multiple drafts, predictive processing.

A working swarm-bot model would not prove anything about brains, but it
would be an existence proof that level-3 architectures can produce
coherent goal-directed behavior. That's worth something.

## When to revisit

After the single-bot simulation has produced at least gen 2 or gen 3,
once we understand what individual temporal cognition looks like and
what its limits are. At that point the question "what does a swarm of
these do?" becomes well-posed.
