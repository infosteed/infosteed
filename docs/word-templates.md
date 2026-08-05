# Word export templates

Administrators can upload deployment-wide Microsoft Word `.docx` templates from **Admin → Word Templates**. InfoSteed preserves the uploaded document package—including its cover, page layout, styles, headers, footers, numbering, document properties and table of contents—and replaces tagged Word content controls during export.

## Prepare a template

Enable Word's **Developer** tab and add a Rich Text Content Control at each value that InfoSteed should populate. Open each control's **Properties** and set its **Tag** (not only its visible title) to one of the values below.

Every template must contain exactly one block-level Rich Text Content Control tagged:

- `INFOSTEED_REPORT_BODY`

Place that control in the main document body where the generated guide should begin. Do not put it inside a paragraph, table cell, header or footer.

In Word, select the complete placeholder paragraph or paragraphs, including the final paragraph mark, before adding the Rich Text Content Control. The control must surround whole paragraphs at document-body level. InfoSteed replaces everything inside this control on export.

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

## Formatting contract

InfoSteed uses the following paragraph style IDs from the uploaded template. Word normally creates these IDs when its built-in styles are used; a custom style with a similar visible name is not equivalent.

| Generated content         | Required Word style ID | Fallback                                             |
| ------------------------- | ---------------------- | ---------------------------------------------------- |
| Guide section title       | `Heading1`             | Bold `Normal`; not a level-1 TOC entry               |
| Step title                | `Heading2`             | Manually numbered body text; not a level-2 TOC entry |
| Instruction, tip or alert | `BodyText`             | `Normal`                                             |

A guide without section header items receives a synthetic **Steps** paragraph using `Heading1`. Each step title uses `Heading2`; its instruction and screenshot follow beneath it.

For section and step numbers such as `1`, `1.1`, `1.2`, `2`, `2.1`, configure one multilevel list in Word:

1. On **Home → Multilevel List**, choose **Define New Multilevel List** and show the advanced options.
2. Link list level 1 to the built-in **Heading 1** style. Use decimal numbering with the `%1` pattern.
3. Link list level 2 to the built-in **Heading 2** style. Include the level-1 number, use the `%1.%2` pattern, and restart level 2 after level 1.
4. If the document has a TOC, configure it to show at least two heading levels.

The internal style IDs must be exactly `Heading1` and `Heading2`. Both styles must reference the same list instance, at zero-based OOXML levels 0 and 1 respectively. InfoSteed reports a compatibility warning when this relationship or its numbering definition is missing.

Screenshots are converted to PNG, preserve their aspect ratio and fit the active section's page width.

Existing TOC, page-number and reference fields are preserved. The document is marked to update fields when opened; Word may ask the reader to approve the refresh.

## Upload validation

Templates are limited to 10 MB compressed and 50 MB expanded. InfoSteed rejects malformed or encrypted archives, unsafe paths, macros, ActiveX, embedded objects, external relationships, unsafe XML and templates without exactly one valid report-body control.

After upload, the compatibility report lists detected InfoSteed tags and non-blocking formatting warnings. It checks for:

- exact `Heading1`, `Heading2` and `BodyText` style IDs;
- `Heading1` and `Heading2` using the same multilevel list at levels 1 and 2;
- decimal `%1` and `%1.%2` numbering definitions;
- Heading 2 restarting beneath each Heading 1 section.

A template with formatting warnings remains usable, but InfoSteed applies the documented fallbacks. Correct the source DOCX and upload it again to obtain template-native headings, numbering and TOC entries.

When no default template exists, Word export uses InfoSteed's standard document. Readers can explicitly choose Standard or any installed template from the guide's Export menu.
