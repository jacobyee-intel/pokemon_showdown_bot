# Schemas

Reserved for versioned, machine-readable Node-to-Python contracts.

There are currently no cross-process schemas. The raw simulator and
`PlayerProtocolTranslator` communicate through in-process TypeScript types
under `simulator/src/core/` and `simulator/src/translator/`.

The first schemas will be added after the model-independent
`PlayerBattleView`, `ActionSet`, and legal-mask contracts are stable. Step 12
will describe their independently versioned JSONL representations plus agent,
terminal, and error messages. This directory will not contain Pokemon
Showdown's raw protocol, static Dex augmentation, model-specific tensor
layouts, or replacements for the semantic TypeScript interfaces used inside
the Node process.
