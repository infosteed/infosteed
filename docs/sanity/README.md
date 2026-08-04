# Import InfoSteed guides into Sanity

InfoSteed's **Export Sanity** action downloads a Sanity dataset import archive containing one published
`workflowGuide` document and its referenced screenshots.

## One-time Studio setup

1. Copy [`schemaTypes.ts`](./schemaTypes.ts) into the `schemaTypes` directory of your Sanity Studio project.
2. Register the exported types in your Studio configuration or schema index. For example:

   ```ts
   import { infosteedSchemaTypes } from "./schemaTypes/infosteed";

   export const schemaTypes = [
     // Your existing types...
     ...infosteedSchemaTypes,
   ];
   ```

3. Deploy or restart Studio so the `workflowGuide` type is available.

The schema is intentionally canonical rather than configurable: InfoSteed exports `workflowGuide`, `workflowStep`,
`guideCallout`, and `infosteedSource` values with these exact names.

## Import a guide

Download **Export Sanity** for a guide, then run the command from a configured Sanity project:

```bash
npx sanity@latest datasets import infosteed-guide-<recording-id>-sanity.tar.gz production
```

The archive contains `data.ndjson` and an `images/` directory. The CLI uploads those images and replaces the temporary
`_sanityAsset` directives with Sanity image references.

## Re-import an updated guide

Each guide has the stable document ID `infosteed-<recording-id>`. Add `--replace` to update the existing document:

```bash
npx sanity@latest datasets import infosteed-guide-<recording-id>-sanity.tar.gz production --replace
```

The import creates a published document, not a Studio draft. It does not require storing Sanity credentials in
InfoSteed and does not trigger a direct API publish from InfoSteed.
