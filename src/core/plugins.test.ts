import { test } from "node:test";
import assert from "node:assert/strict";
import { definePlugin, registerPlugin, getFieldType, runDataHook } from "./plugins.js";

test("registers a custom field type", () => {
  registerPlugin(
    definePlugin({
      name: "t-color",
      fieldTypes: [
        {
          type: "color",
          validate: (v) =>
            typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? null : "bad color",
        },
      ],
    }),
  );
  const ft = getFieldType("color");
  assert.ok(ft);
  assert.equal(ft!.validate("#aabbcc", { name: "c", type: "color" } as never), null);
  assert.equal(typeof ft!.validate("nope", { name: "c", type: "color" } as never), "string");
});

test("data hooks fold over the data in registration order", async () => {
  registerPlugin(
    definePlugin({
      name: "t-hook-a",
      hooks: { beforeCreate: ({ data }) => ({ ...data, a: 1 }) },
    }),
  );
  registerPlugin(
    definePlugin({
      name: "t-hook-b",
      hooks: { beforeCreate: ({ data }) => ({ ...data, b: (data.a as number) + 1 }) },
    }),
  );
  const out = await runDataHook("beforeCreate", { type: "x", data: {}, tenantId: "t" });
  assert.equal(out.a, 1);
  assert.equal(out.b, 2);
});
