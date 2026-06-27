import { definePlugin } from "../../core/plugins.js";

/**
 * Example plugin: computes `reading_time` (minutes) from a `body` field on every
 * create/update. The content type must declare a `reading_time` number field for
 * the value to be stored (unknown keys are dropped on validation).
 */
function withReadingTime(data: Record<string, unknown>): Record<string, unknown> {
  const body = data.body;
  if (typeof body !== "string") return data;
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return { ...data, reading_time: Math.max(1, Math.ceil(words / 200)) };
}

export default definePlugin({
  name: "reading-time",
  hooks: {
    beforeCreate: ({ data }) => withReadingTime(data),
    beforeUpdate: ({ data }) => withReadingTime(data),
  },
});
