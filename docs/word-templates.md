# Word export templates

Administrators can upload deployment-wide Microsoft Word `.docx` templates from **Admin → Word Templates**. InfoSteed preserves the uploaded document package—including its cover, page layout, styles, headers, footers, numbering, document properties and table of contents—and replaces tagged Word content controls during export.

## Prepare a template

Enable Word's **Developer** tab and add a Rich Text Content Control at each value that InfoSteed should populate. Open each control's **Properties** and set its **Tag** (not only its visible title) to one of the values below.

Every template must contain exactly one block-level Rich Text Content Control tagged:

- `INFOSTEED_REPORT_BODY`

Place that control in the main document body where the generated guide should begin. Do not put it inside a paragraph, table cell, header or footer.

The following text-control tags are optional and may be repeated, including in headers and footers:

- `INFOSTEED_TITLE`
- `INFOSTEED_PURPOSE`
- `INFOSTEED_AUTHOR`
- `INFOSTEED_STATUS`
- `INFOSTEED_VERSION`
- `INFOSTEED_DATE`
- `INFOSTEED_APPROVER`
- `INFOSTEED_CHANGELOG_VERSION`
- `INFOSTEED_CHANGELOG_STATUS`
- `INFOSTEED_CHANGELOG_DATE`
- `INFOSTEED_CHANGELOG_DETAILS`
- `INFOSTEED_CHANGELOG_AUTHOR`

Visible placeholders such as `<Document Title>` are not interpreted. The content-control Tag must be set exactly.

## Generated values

InfoSteed fills the title and purpose from the guide. The author is the guide owner, falling back to the exporting user. An unfinished guide exports as Draft version 0.1; a finalized guide exports as Final version 1.0. Dates use long British English format in UTC, approver is blank, and the initial change-log description is `Initial InfoSteed export`.

Guide headers use the template's `Heading1` style. Instructions, tips and alerts use `BodyText` when available and otherwise `Normal`. A guide without header items receives a `Steps` heading. Screenshots are converted to PNG, preserve their aspect ratio and fit the template's page width.

Existing TOC, page-number and reference fields are preserved. The document is marked to update fields when opened; Word may ask the reader to approve the refresh.

## Upload validation

Templates are limited to 10 MB compressed and 50 MB expanded. InfoSteed rejects malformed or encrypted archives, unsafe paths, macros, ActiveX, embedded objects, external relationships, unsafe XML and templates without exactly one valid report-body control. A compatibility report lists detected InfoSteed tags and non-blocking warnings after upload.

When no default template exists, Word export uses InfoSteed's standard document. Readers can explicitly choose Standard or any installed template from the guide's Export menu.
