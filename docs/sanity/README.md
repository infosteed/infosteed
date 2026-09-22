# Import InfoSteed guides into Sanity

InfoSteed's **Export Sanity** action downloads a Sanity dataset import archive containing one published
`workflowGuide` document and its referenced screenshots. The guide body is standard Portable Text: text blocks,
list blocks, links, headings, and images. It does not contain product-specific article fields or references.

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

The document envelope uses the InfoSteed-neutral `workflowGuide` and `infosteedSource` types. Guide steps and
callouts are flattened into ordinary Portable Text blocks, so consumers can map the `body` array into their own
document type without having to support InfoSteed-specific block objects. Step titles use standard `h2` blocks;
tip and alert labels and their content use standard `blockquote` blocks, with the callout type retained in the bold
label text.

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
