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

export const workflowStep = defineType({
  name: "workflowStep",
  title: "Workflow step",
  type: "object",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "instruction",
      title: "Instruction",
      type: "array",
      of: [portableTextBlock],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "image",
      title: "Screenshot",
      type: "image",
      fields: [
        defineField({ name: "alt", title: "Alternative text", type: "string" }),
      ],
    }),
    defineField({
      name: "source",
      title: "Source",
      type: "string",
      readOnly: true,
      options: { list: ["deterministic", "ai", "manual"] },
    }),
    defineField({
      name: "userEdited",
      title: "User edited",
      type: "boolean",
      readOnly: true,
    }),
  ],
  preview: {
    select: { title: "title", media: "image" },
  },
});

export const guideCallout = defineType({
  name: "guideCallout",
  title: "Guide callout",
  type: "object",
  fields: [
    defineField({
      name: "tone",
      title: "Tone",
      type: "string",
      options: {
        layout: "radio",
        list: [
          { title: "Tip", value: "tip" },
          { title: "Alert", value: "alert" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
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
      of: [portableTextBlock],
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "tone" },
  },
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
      name: "purpose",
      title: "Purpose",
      type: "array",
      of: [portableTextBlock],
    }),
    defineField({ name: "audience", title: "Audience", type: "string" }),
    defineField({
      name: "content",
      title: "Content",
      type: "array",
      of: [
        portableTextBlock,
        defineArrayMember({ type: "workflowStep" }),
        defineArrayMember({ type: "guideCallout" }),
      ],
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

export const infosteedSchemaTypes = [
  infosteedSource,
  workflowStep,
  guideCallout,
  workflowGuide,
];
