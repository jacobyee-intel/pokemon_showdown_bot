# Schemas

Reserved for versioned, machine-readable Node-to-Python contracts.

There are currently no cross-process schemas. The raw simulator and
`PlayerProtocolTranslator` communicate through in-process TypeScript types
under `simulator/src/core/` and `simulator/src/translator/`.

The first schemas will be added after the observation and action contracts are
finalized. They will describe serialized messages for the later JSONL
transport; this directory will not contain Pokemon Showdown's raw protocol or
replace the TypeScript interfaces used inside the Node process.
