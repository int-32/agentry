# Channels EARS

Full feature spec: `../../docs/specs/features/channels-and-agent-collaboration.md`

## Module Scope

`lib/channels/` owns the local channel file contract: channel metadata, optional project snapshot metadata, optional task-board execution-domain metadata, message parsing, member validation, read/write locking, mention helpers, and background channel polling support.

## Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-CHANNEL-001 | Ubiquitous | The system shall persist each channel as a local Markdown file with frontmatter metadata and append-only message history. | AG-BDD-CHANNEL-001 | AG-TDD-CHANNEL-001 |
| AG-EARS-CHANNEL-002 | Ubiquitous | The system shall require at least two Agent members for an Agent collaboration channel. | AG-BDD-CHANNEL-002 | AG-TDD-CHANNEL-002 |
| AG-EARS-CHANNEL-003 | Event-driven | When a message is appended to a channel, the system shall serialize writes to the same channel file to avoid interleaved or corrupted content. | AG-BDD-CHANNEL-003 | AG-TDD-CHANNEL-003 |
| AG-EARS-CHANNEL-004 | State-driven | While an Agent is not a channel member, the system shall not route private channel messages to that Agent. | AG-BDD-CHANNEL-004 | AG-TDD-CHANNEL-004 |
| AG-EARS-CHANNEL-006 | Event-driven | When a channel is created with a project id, the system shall store the selected project's metadata as channel frontmatter and expose it in channel list/read responses. | AG-BDD-CHANNEL-006, AG-BDD-PROJECT-004 | AG-TDD-CHANNEL-006 |
| AG-EARS-CHANNEL-008 | Event-driven | When a channel is bound to a project board, the system shall store board id/title/coordinator/collaborator fields as channel frontmatter and expose them in channel projections. | AG-BDD-CHANNEL-008 | AG-TDD-CHANNEL-008 |

## Non-goals

- External bridge group protocol rules live outside this module.
- Desktop panel visibility rules are tracked in the full feature spec, not this local file contract.
- Project registry creation and validation live under `lib/projects/`; this module only stores the channel snapshot.
