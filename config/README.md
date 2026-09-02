# Config

Reserved for future simulator, model, training, and evaluation settings.

There are currently no runtime configuration files. Existing deterministic
inputs—Showdown version, seeds, golden scenarios, and scripted choices—remain
in the package manifest or typed TypeScript source so their behavior is
explicit and reproducible.

Configuration should be added here only when a runtime component needs
user-selectable settings. The current raw simulator and translator APIs must
not depend on configuration files to define their message contracts.
