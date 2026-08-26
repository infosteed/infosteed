# Confluence export plan

Status: Proposed MVP  
Owner: Product and Engineering  
Last updated: 12 August 2026

## Decision

Use InfoSteed's existing standard DOCX export for manual Confluence import.

The MVP does not add another exporter, file format, API route, database table, credential, or background job. It adds a Confluence-labelled path to the existing standard Word download and explains how to import that file into Confluence.

Direct publishing with OAuth may be considered later, after the manual workflow has been used and validated.

## Existing capability to reuse

- `buildWorkflowDocx` already generates a complete DOCX with guide title, purpose, ordered headers/steps, tips, alerts, bold text, annotated screenshots, and alt text.
- `GET /recordings/:id/export/word?templateId=standard` already applies recording read authorization, loads screenshots, converts them to PNG, and returns a DOCX attachment.
- `wordExportUrl(recordingId, "standard")` already builds the required browser URL.
- Existing exporter, API boundary, and Word-template menu tests cover the core path.

The Confluence action must force `templateId=standard`. It must not use the deployment's default or administrator-uploaded Word template because those documents may contain covers, headers, content controls, or other structures that import unpredictably.

## User experience

Add **Confluence (DOCX)** to the existing guide header's **More → Export** section.

Selecting it opens a small **Export to Confluence** dialog containing:

> Download the guide as a Word document, then import it into Confluence. This creates a copy and does not stay synchronized with InfoSteed.

The dialog provides:

- **Download DOCX**, linked to `wordExportUrl(recording.id, "standard")`.
- Confluence Cloud instructions:
  1. Create a blank page or live doc.
  2. Open **More actions → Templates and import**.
  3. Select **Import → Word document (.docx)** and choose the downloaded file.
  4. Review the draft, set its location and permissions, then publish.
- A short Data Center note: use **Import Word Document**, choose **Don't split** if prompted, and ask an administrator if the Office Connector action is unavailable.

The existing **Word** and Word-template actions remain unchanged.

## Scope

### In scope

- One new export-menu action.
- One small explanatory dialog using the existing dialog components.
- Reuse of the existing standard Word download URL.
- Translation strings and focused component tests.
- A manual Confluence import compatibility check.
- User-facing documentation for the workflow.

### Out of scope

- Changes to `buildWorkflowDocx` unless the compatibility check finds a concrete import defect.
- A new Confluence-specific API endpoint or filename.
- A new DOCX profile.
- Confluence HTML, XML, storage-format, or space-import archives.
- OAuth, API tokens, direct publishing, page updates, or synchronization.
- Site, space, parent-page, title, or permission selection inside InfoSteed.
- Any persistence or audit schema changes.

## Acceptance criteria

1. A guide editor sees **Confluence (DOCX)** alongside the existing export formats.
2. Selecting it explains that the workflow is a manual, point-in-time copy.
3. **Download DOCX** uses the existing standard Word endpoint with `templateId=standard`.
4. The deployment's default Word template does not affect the downloaded Confluence document.
5. The existing Word export and template menu remain unchanged.
6. Importing the downloaded DOCX into current Confluence Cloud produces one editable page containing the guide title, purpose, headers, ordered steps, tips, alerts, bold text, and screenshots in the expected order.
7. The UI contains no Atlassian connection or destination controls and makes no Atlassian network request.

## Implementation plan

### 1. Compatibility check

- Download a representative guide through the existing standard Word URL.
- Import it into a disposable Confluence Cloud page.
- Verify title, purpose, heading/step numbering, tips, alerts, bold text, screenshot order/aspect ratio, and alt text where Confluence exposes it.
- Record any importer loss. Change the existing standard DOCX exporter only for a confirmed defect that also makes sense for normal Word export; otherwise document the limitation.

### 2. Web UI

- Add Confluence dialog state to the recording header/controller at the narrowest appropriate component boundary.
- Add **Confluence (DOCX)** to the current Export section.
- Build the dialog from existing UI primitives.
- Point **Download DOCX** at `wordExportUrl(recording.id, "standard")`.
- Add the Cloud steps, Data Center note, and point-in-time-copy warning.
- Add translation strings through the existing i18n mechanism.

### 3. Automated tests

- Extend `RecordingHeader` tests to assert that the Confluence action is present.
- Assert that the dialog opens, contains the import guidance, and links to the standard Word URL with `templateId=standard`.
- Assert that an installed default Word template does not change that link.
- Run the existing web tests, type-check, and Word export tests. No new API tests are required because no API surface changes.

### 4. Documentation and release

- Add the manual Confluence import steps to user documentation.
- Note that imported pages are not synchronized and re-import behaviour is controlled by Confluence.
- Add the feature to the changelog and release-readiness checklist.
- Complete the Confluence Cloud smoke test before release.

## Later phase

If manual usage justifies direct publishing, separately design OAuth authorization, destination selection, page/attachment creation, page mappings, update conflicts, token encryption, auditing, and partial-failure recovery. None of that belongs in this MVP.
