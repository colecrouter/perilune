# Perilune development

- Stack: SvelteKit 3, Effect 4, Vite+, Node 24, SQLite via Effect SQL, Bits UI.
- Use pnpm scripts / local Vite+ commands. Keep all automated browser tests headless.
- Formatting uses tabs, Oxfmt for supported files, Prettier for Svelte.
- Validate with `pnpm validate`; CI also verifies the Docker image.
- Printer connections and workers belong to process-scoped Effect services,
  never browser lifetimes or finite request scopes. Close stream iterators on abort.
- Commands need explicit lifecycle, bounded queuing, idempotent submission,
  execution-time validation, expiry, and unknown-outcome handling. Never blindly
  retry physical commands after losing an acknowledgement.
- Preserve UI drafts through incoming state changes and reconnects.
- The initial app is a simulator. Real printer movement, heating, firmware/config
  writes, and destructive actions require coordinated testing with the owner.
- Keep private hostnames, network addresses, credentials, printer configuration,
  and captured private media out of the public repository.
- Docs/architecture.md records the implemented scope and outstanding milestones.
