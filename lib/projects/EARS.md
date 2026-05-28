# Projects EARS

Full feature spec: `../../docs/specs/features/project-registry.md`

## Module Scope

`lib/projects/` owns the local project registry contract: project metadata normalization, absolute directory validation, durable JSON persistence under the user data directory, stable project IDs, and sorted project listing. It does not own task execution, channel routing, or desktop form presentation.

## Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-PROJECT-001 | Ubiquitous | The system shall persist user project registry entries in a local JSON file under the Agentry user data directory. | AG-BDD-PROJECT-001 | AG-TDD-PROJECT-001 |
| AG-EARS-PROJECT-002 | Unwanted behavior | If a project name or workspace root is missing, or if workspace/docs roots are not absolute existing directories, the registry shall reject the write with an explicit error and shall not create a partial project. | AG-BDD-PROJECT-002 | AG-TDD-PROJECT-002 |
| AG-EARS-PROJECT-003 | Event-driven | When a project is created, updated, or deleted through the API, the system shall emit a `projects-changed` app event carrying the affected project id. | AG-BDD-PROJECT-003 | AG-TDD-PROJECT-003 |
| AG-EARS-PROJECT-004 | Event-driven | When a channel is created with a project id, the channel shall store a snapshot of the project metadata and later expose that snapshot with the channel record. | AG-BDD-PROJECT-004 | AG-TDD-PROJECT-004 |

## Non-goals

- Project registry entries do not execute tasks by themselves.
- Project registry entries do not replace workspace approval or session cwd rules.
- Project-linked channel routing remains governed by the channel membership contract.
