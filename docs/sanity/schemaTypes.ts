import { defineArrayMember, defineField, defineType } from "sanity";

const portableTextBlock = defineArrayMember({
  type: "block",
  styles: [
    { title: "Normal", value: "normal" },
    { title: "Heading 1", value: "h1" },
    { title: "Heading 2", value: "h2" },
    { title: "Heading 3", value: "h3" },
    { title: "Heading 4", value: "h4" },
    { title: "Heading 5", value: "h5" },
    { title: "Heading 6", value: "h6" },
    { title: "Quote", value: "blockquote" },
  ],
  lists: [
    { title: "Bullet", value: "bullet" },
    { title: "Numbered", value: "number" },
  ],
  marks: {
    decorators: [
      { title: "Strong", value: "strong" },
      { title: "Emphasis", value: "em" },
      { title: "Code", value: "code" },
    ],
    annotations: [
      {
        name: "link",
        title: "Link",
        type: "object",
        fields: [
          defineField({ name: "href", title: "URL", type: "url" }),
          defineField({ name: "title", title: "Title", type: "string" }),
        ],
      },
    ],
  },
});

const portableTextImage = defineArrayMember({
  type: "image",
  fields: [
    defineField({ name: "alt", title: "Alternative text", type: "string" }),
  ],
});

export const infosteedSource = defineType({
  name: "infosteedSource",
  title: "InfoSteed source",
  type: "object",
  fields: [
    defineField({
      name: "recordingId",
      title: "Recording ID",
      type: "string",
      readOnly: true,
    }),
    defineField({
      name: "createdAt",
      title: "Created at",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "updatedAt",
      title: "Updated at",
      type: "datetime",
      readOnly: true,
    }),
    defineField({
      name: "finalizedAt",
      title: "Finalized at",
      type: "datetime",
      readOnly: true,
    }),
  ],
});

export const workflowGuide = defineType({
  name: "workflowGuide",
  title: "Workflow guide",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      of: [portableTextBlock, portableTextImage],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "source",
      title: "Source",
      type: "infosteedSource",
      readOnly: true,
    }),
  ],
});

export const infosteedSchemaTypes = [infosteedSource, workflowGuide];
