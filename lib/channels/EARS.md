# Channels EARS

Full feature spec: `../../docs/specs/features/channels-and-agent-collaboration.md`

## Module Scope

`lib/channels/` owns the local channel file contract: channel metadata, message parsing, member validation, read/write locking, mention helpers, and background channel polling support.

## Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-CHANNEL-001 | Ubiquitous | The system shall persist each channel as a local Markdown file with frontmatter metadata and append-only message history. | AG-BDD-CHANNEL-001 | AG-TDD-CHANNEL-001 |
| AG-EARS-CHANNEL-002 | Ubiquitous | The system shall require at least two Agent members for an Agent collaboration channel. | AG-BDD-CHANNEL-002 | AG-TDD-CHANNEL-002 |
| AG-EARS-CHANNEL-003 | Event-driven | When a message is appended to a channel, the system shall serialize writes to the same channel file to avoid interleaved or corrupted content. | AG-BDD-CHANNEL-003 | AG-TDD-CHANNEL-003 |
| AG-EARS-CHANNEL-004 | State-driven | While an Agent is not a channel member, the system shall not route private channel messages to that Agent. | AG-BDD-CHANNEL-004 | AG-TDD-CHANNEL-004 |

## Non-goals

- External bridge group protocol rules live outside this module.
- Desktop panel visibility rules are tracked in the full feature spec, not this local file contract.
