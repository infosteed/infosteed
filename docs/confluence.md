# Import a guide into Confluence

InfoSteed uses its standard Word export for manual Confluence imports. The imported page is a point-in-time copy and does not stay synchronized with the guide in InfoSteed.

## Download the guide

1. Open the guide editor in InfoSteed.
2. Open **More → Export → Confluence (DOCX)**.
3. Select **Download DOCX**.

The Confluence action always uses InfoSteed's standard Word layout. An administrator's default Word template does not affect this download.

## Import into Confluence Cloud

1. Create a blank page or live doc in Confluence.
2. Open **More actions → Templates and import**.
3. Select **Import → Word document (.docx)** and choose the downloaded file.
4. Review the draft, set its location and permissions, then publish it.

Import one guide at a time. Re-exporting from InfoSteed creates another DOCX; whether a later import replaces or creates Confluence content is controlled in Confluence.

## Import into Confluence Data Center

Use **Import Word Document** and choose **Don't split** if Confluence asks how to handle headings. If the action is unavailable, ask your Confluence administrator whether the Office Connector is enabled.

Rendered formatting can vary between Confluence versions. Review step numbering, tips, alerts, screenshots, and access permissions before publishing the imported page.
