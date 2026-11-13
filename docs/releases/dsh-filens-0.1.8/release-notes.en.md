# FiLens for DSH 0.1.8: a home for your session files

> Released with [v0.6.6](https://github.com/orca-zhang/filens/releases/tag/v0.6.6). Linked demos were refreshed with FiLens DSH 0.1.10 to display the current branding.

Open **File workspace** to browse files referenced in your conversations, preview them, and return to the message or question they came from.

![File workspace recorded in DSH Desktop](../../assets/dsh-release/file-workspace.en.gif?v=branding-20261114)

## File workspace

- Collect supported local paths and attachments from paginated session history. Deduplicate files while retaining each source occurrence.
- Browse collapsed session cards with short readable titles and up to four representative previews. Hover for the full title. Word, Excel, PowerPoint and PDF thumbnails use the real renderer.
- Search and filter files, switch grid/list views, select local files or drag them in. Type covers keep files recognizable when a thumbnail is unavailable.
- Open related files ranked by shared message, question, folder and session. Each recommendation explains the relationship.
- Inspect properties, location, related files and reference sources, then jump to the exact message or question. Narrow windows use a bottom information card.
- Hide Office lock files, system artifacts and editor temporary files by default, with a reveal button. Keep useful outputs stored in OS temporary directories.

- **0.1.8:** exclude paths and attachments confirmed missing by DSH; refresh rechecks existence and opening removes references deleted after scanning. Permission and connection failures remain visible.

## Native sidebar previews remain available

The sidebar continues to preview Office, PDF, iWork, CAD/3D, RAW and 360° media. Compact zoom and fullscreen controls remain available, with a 144–160px file list in the workspace reader. File workspace, sidebar Preview and document Tools have independent switches and share the local preview core.

[Office GIF](../../assets/dsh-release/office-preview.en.gif?v=branding-20261114) · [3D / panorama GIF](../../assets/dsh-release/3d-and-panorama.en.gif?v=branding-20261114) · [All media](README.md)

360° interaction hints, playback controls, tooltips and accessibility labels follow the DSH language. Switching languages updates the controls without reloading the video or resetting its playback position.

## Install

Fully quit Desktop, run the command, then reopen it:

```sh
dsh plugin --profile desktop add dsh-filens@0.1.8 dsh-filens-workspace@0.1.1
```

## Validation and limits

The Chinese and English demos were refreshed separately in the installed DSH Desktop 0.2.2-rc.1 on macOS arm64, with synthetic conversations, real documents and no model calls. The workspace has 22 existing desktop regression checks. Recording assertions also cover file opening, sheet switching, fullscreen slides, 3D/panorama interaction, thumbnails and navigation to the originating question.

The workspace indexes references; it does not copy or back up source files. Deleted or inaccessible files may not preview, and browser-selected files must be reopened after a reload. Temporary-file filtering only changes visibility. Format coverage and fidelity retain the [support matrix](../../support-matrix.md) limits. No new cross-platform native tests or performance benchmarks are claimed.
