# Peekaboo Dialog File

## Purpose
Choose a file in a system dialog through Peekaboo.

## Wrapper Operation
- Tool id: `peekaboo.dialog.file`
- Wrapper operation: `dialog.file`
- Peekaboo CLI mapping: `peekaboo dialog file`

## Host Peekaboo Configuration
- Install Peekaboo on the external gateway host: `brew install steipete/tap/peekaboo`.
- Grant Screen Recording and Accessibility permissions for the host process that launches Peekaboo.
- Verify `peekaboo permissions status --json` works outside Spaces before relying on this managed bundle.
- Set `SPACES_PEEKABOO_EXECUTABLE` if the binary is not resolvable from PATH or common macOS install directories.

## Payload
- `arguments` (optional): Optional extra positional arguments to append after the Peekaboo subcommand.
- `flags` (optional): Optional Peekaboo flags. Use raw CLI flag keys such as `app`, `window-title`, `snapshot`, `coords`, `path`, or `mode`.
- `presentFlags` (optional): Optional flag names rendered without values, for example `annotate`, `retina`, `foreground`, or `return`.
- `stdin` (optional): Optional stdin payload forwarded to the Peekaboo CLI command.

## Example Payloads
```json
[
  {
    "payload": {}
  }
]
```

## Output Contract
- The wrapper always emits JSON.
- Success shape: `{ ok, operation, summary, data?, refs? }`.
- Peekaboo JSON output is parsed into `data`; text output is normalized into `data.text`.

## Approval Guidance
- Keep explicit human approval enabled for every Peekaboo tool.
- Capture and discovery commands can expose screen contents and should be treated as sensitive reads.
- Desktop-driving and state-changing commands are marked destructive because they can click, type, move windows, switch apps, or dismiss dialogs.

