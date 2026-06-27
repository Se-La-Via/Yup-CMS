import { definePlugin } from "../../core/plugins.js";

/**
 * Example plugin: adds an "email" field type with format validation.
 * Enable it by adding this module to plugins.json or CMS_PLUGINS.
 */
export default definePlugin({
  name: "email-field",
  fieldTypes: [
    {
      type: "email",
      validate(value) {
        if (typeof value !== "string") return "expected a string";
        return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
          ? null
          : "must be a valid email address";
      },
    },
  ],
});
