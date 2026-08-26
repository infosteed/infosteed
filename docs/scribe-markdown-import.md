# Scribe Markdown import

InfoSteed can migrate a Scribe Markdown export and copy its remotely hosted screenshots into a normal, locally stored guide.

From the Library, choose **Import → Scribe Markdown** and select a `.md` export. The import runs in the background. Reopen the Import dialog to see progress after navigating away or refreshing the page.

Screenshot requests are processed one at a time across the deployment. Transient network and server failures are retried automatically. A guide is created with a warning when up to three screenshots remain unavailable; four or more missing screenshots fail the import. Failed imports can be retried without downloading successful screenshots again.

Only absolute HTTPS image URLs resolving exclusively to public network addresses are accepted. Imported PNG, JPEG, WebP and GIF images are flattened to WebP and stored in InfoSteed, including annotations already baked into Scribe's exported screenshots.

The defaults can be adjusted with:

| Setting                               |     Default | Purpose                                   |
| ------------------------------------- | ----------: | ----------------------------------------- |
| `SCRIBE_IMPORT_IMAGE_DELAY_MS`        |       `750` | Delay between remote request starts       |
| `SCRIBE_IMPORT_IMAGE_MAX_BYTES`       |  `20971520` | Maximum bytes for one source image        |
| `SCRIBE_IMPORT_TOTAL_IMAGE_MAX_BYTES` | `104857600` | Maximum source-image bytes for one import |
| `SCRIBE_IMPORT_IMAGE_TIMEOUT_MS`      |     `30000` | Timeout for one remote request            |

Import job data is retained for 30 days. Completed guide screenshots use the normal guide storage lifecycle and are not removed with the import job.
