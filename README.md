# Taskpress

A small mechanical pixel-art planner: cream ruled paper, red/plum casing, working round keys and a brass paper-feed knob.

## Run

```powershell
cd D:\usr\todo_list-hermes
npm install
npm start
```

Type a task and press **Enter**. End a line with `:` to make a plan heading. Click a checkbox to finish a task; click again to reopen it. Finished sections receive a DONE stamp. The title at the top is editable.

- **X**: outside the text inputs, toggle the focused/selected task, or the first pending task if none is selected.
- **Esc**: leave the input. **Ctrl+Shift+D**: feed out completed tasks.
- **⌖**: pin/unpin above other windows. **♪**: toggle mechanical sounds.
- **↟ / brass ↥ knob**: clear completed lines. Round letter keys and the spacebar also type into the input.
- Drag the date strip, roller or TaskPress name to move the window. Drag the bottom-right grip to resize; focused grip also accepts arrow keys.

Tasks save to `%APPDATA%\Taskpress\tasks.json` before animations play. Closing during an animation loses no saved task. Only completed tasks are cleared; headings and pending tasks stay.

## Edit and delete tasks or sections

Each task and section has two small controls on its right:

- **✎** edits the line in place. Change the text, then press **Enter** or **✓** to save. Press **Esc** or **×** to cancel. Double-clicking the task text or heading also starts editing.
- **×** removes the line after the **Delete** confirmation. Choose **Keep** or press **Esc** to cancel deletion.

You can focus/select a line and press **F2** to edit or **Delete** to remove it. The on-screen typewriter keys work in the editor too.

Editing a task preserves its checked state and completion timestamp. Editing a heading renames its section. Deleting a heading keeps its tasks; they belong to the preceding remaining section, or stay without a heading if there is none. Existing completion logs remain intact. Edits and deletions are timestamped in the daily activity journal, and `current-tasks.md` reflects the updated page. Failed sync keeps these events queued across restarts.

## Create sections like the reference

In the task input, type a heading ending with a colon (`:`) and press **Enter**. For example, type `Phase 1: Script prep:`. The app renders it as a section heading instead of a checkbox task.

Then add each task with **Enter**. Tasks belong to the most recent section until you add another heading. Enter these lines one at a time:

```text
Phase 1: Script prep:
Fill in missing parts of the script
Prepare the shot list
Phase 2: Test run:
Test the camera and microphone
Check the timer
Phase 3: Filming:
Film the intro
Film the main video
```

You can also use simpler headings such as `Study plans:` or `Video production:`. The final colon creates the section; colons inside the heading are fine.

When every task under a section is checked, its heading gets a **DONE** stamp. Reopening a task removes that stamp. Sections and their tasks appear in the Obsidian current-page note, and completed tasks also go into the completion log. To name the whole page, edit the title at the top.

## Obsidian

Edit `config.json` to change the vault without changing code. Configuration is reread on each sync. The vault folder must already exist. The initial path is `G:\My Drive\Obsidian Sync`.

- `Personal Tools/Typewriter/Log.md`: append-only completion history with local timestamps.
- `Personal Tools/Typewriter/YYYY-MM-DD.md`: append-only journal of additions, headings, completions, reopening, edits, deletions, clearing and title changes.
- `Personal Tools/Typewriter/current-tasks.md`: current page, including sections and checkboxes. Handwritten text outside the managed markers is preserved.

Sync runs **from Taskpress to Obsidian**. Edits made inside Obsidian are not imported into the app. Do not edit the managed block; place personal notes outside it. Event comments prevent duplicate logs after a retry. Failed writes remain queued locally, even after clearing; click **Retry sync** after repairing the path or restoring vault access. Relaunching retries too. A completion, reopen and later completion intentionally produces two historical completions.

`typingSpeedMs` defaults to 35 ms per character. Long lines accelerate so the reveal finishes within 400 ms. `timeZone` defaults to `Asia/Calcutta`. Reduced-motion preferences disable typing, stamp and feed animation. Audio is generated locally with Web Audio; no network, external font or sound files are required.

## Checks

```powershell
npm test
npm run test:e2e
```

Tests use temporary task storage and vaults. Desktop tests exercise actual Electron input, editing/deletion, persistence, sync retries, pinning, dragging, resizing and reduced motion. Screenshots are saved in `output/`.

## License

[MIT](LICENSE) © 2026 lyricsofsongs96 — free to use, modify, and redistribute with attribution.
