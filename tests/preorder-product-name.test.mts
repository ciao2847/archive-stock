import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import {
  buildPreorderProductName,
  suggestPreorderWorkName,
} from "../src/lib/preorder-product-name.ts";

test("preorder names support free item names and replace flags when countries change", () => {
  for (const [country, flag] of [
    ["韓國", "🇰🇷"],
    ["日本", "🇯🇵"],
    ["台灣", "🇹🇼"],
    ["香港", "🇭🇰"],
    ["大陸", "🇨🇳"],
    ["馬來西亞", "🇲🇾"],
    ["北美", "🇺🇸"],
    ["飯製", "🎨"],
  ]) {
    for (const item of [
      "A款",
      "B款",
      "全員款",
      "肖像款",
      "IMAX B款",
      "月光下的約定",
    ]) {
      assert.equal(
        buildPreorderProductName(country, "蜘蛛人", item),
        `${flag} 蜘蛛人 ${item}`,
      );
    }
    assert.equal(
      buildPreorderProductName(country, " 🇰🇷 蜘蛛人 ", "🇯🇵 A款"),
      `${flag} 蜘蛛人 A款`,
    );
  }
  assert.equal(buildPreorderProductName("韓國", "蜘蛛人", ""), "🇰🇷 蜘蛛人");
  assert.equal(suggestPreorderWorkName("蜘蛛人預購"), "蜘蛛人");
  assert.equal(suggestPreorderWorkName("蜘蛛人｜訂購表單"), "蜘蛛人");
  assert.equal(suggestPreorderWorkName("蜘蛛人：無家日"), "蜘蛛人：無家日");
});

const globals = globalThis as typeof globalThis & {
  namingAuth: unknown;
  namingRows: Array<Record<string, unknown>>;
  namingCalls: Array<{ name: string; args: Record<string, unknown> }>;
};
const bundle = await build({
  entryPoints: [
    "src/app/api/products/route.ts",
    "src/app/api/products/[id]/route.ts",
    "src/app/api/claim-forms/route.ts",
    "src/lib/validation/products.ts",
    "src/adapters/productAdapter.ts",
  ],
  outdir: "/tmp/preorder-api-tests",
  outbase: "src",
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "auth-fixture",
      setup(builder) {
        builder.onResolve({ filter: /api\/server-auth$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "empty",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "empty"
              ? ""
              : `export const requireApiUser=async()=>globalThis.namingAuth;export const apiSuccess=(data,status=200)=>Response.json({success:true,data},{status});export const apiFailure=(error,status)=>Response.json({success:false,error},{status});export const withApiErrorHandling=async(_,callback)=>callback();`,
        }));
      },
    },
  ],
});
const modules = await Promise.all(
  bundle.outputFiles.map(
    (file) =>
      import(
        `data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`
      ),
  ),
);
const findModule = (part: string) =>
  modules[bundle.outputFiles.findIndex((file) => file.path.endsWith(part))];
const products = findModule("app/api/products/route.js"),
  product = findModule("app/api/products/[id]/route.js"),
  claims = findModule("app/api/claim-forms/route.js"),
  schemas = findModule("lib/validation/products.js");
const owner = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002",
  id = "00000000-0000-4000-8000-000000000003";
const input = {
  ownerId: owner,
  name: "🇰🇷 蜘蛛人 全員款",
  work: "蜘蛛人",
  preorderItemName: "全員款",
  preorderOnly: true,
  country: "韓國",
  category: "海報",
  source: "",
  location: "",
  stock: 0,
  price: 250,
  imagePaths: [],
  crafts: [],
  format: "",
  size: "A3",
  feature: "",
};
function fixture() {
  globals.namingCalls = [];
  globals.namingRows = [];
  globals.namingAuth = {
    ok: true,
    role: "staff",
    inventoryOwnerId: owner,
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        globals.namingCalls.push({ name, args });
        return {
          data:
            name === "configure_claim_form"
              ? [{ form_id: 1, public_token: owner }]
              : id,
          error: null,
        };
      },
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: globals.namingRows, error: null }),
        };
        return chain;
      },
    },
  };
}
const request = (url: string, method: string, body: unknown) =>
  new Request("https://example.com" + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("named preorder APIs persist structured naming atomically and retain inventory authorization", async () => {
  fixture();
  assert.equal(
    (await products.POST(request("/api/products", "POST", input))).status,
    201,
  );
  assert.equal(globals.namingCalls[0].name, "save_named_inventory_product");
  assert.equal(globals.namingCalls[0].args.p_owner_id, owner);
  assert.equal(
    (globals.namingCalls[0].args.p_input as typeof input).preorderItemName,
    "全員款",
  );
  for (const country of ["馬來西亞", "北美"]) {
    assert.equal(
      (
        await products.POST(
          request("/api/products", "POST", { ...input, country }),
        )
      ).status,
      201,
    );
  }
  globals.namingCalls = [];
  assert.equal(
    (
      await products.POST(
        request("/api/products", "POST", { ...input, ownerId: other }),
      )
    ).status,
    403,
  );
  assert.equal(globals.namingCalls.length, 0);
  for (const changes of [
    { country: "" },
    { work: undefined },
    { stock: 1 },
    { preorderItemName: "x".repeat(201) },
  ]) {
    assert.equal(
      (
        await products.POST(
          request("/api/products", "POST", { ...input, ...changes }),
        )
      ).status,
      400,
    );
  }
  assert.equal(globals.namingCalls.length, 0);
  assert.equal(
    (
      await product.PATCH(
        request("/api/products/" + id, "PATCH", {
          ...input,
          country: "日本",
          preorderItemName: "A款",
          stock: 2,
        }),
        { params: Promise.resolve({ id }) },
      )
    ).status,
    200,
  );
  assert.equal(globals.namingCalls[0].args.p_product_id, id);
  assert.equal((globals.namingCalls[0].args.p_input as typeof input).stock, 2);
  assert.equal(
    schemas.updateProductSchema.safeParse({
      ...input,
      preorderItemName: "",
      work: "蜘蛛人",
    }).success,
    true,
  );
});
const claimInput = {
  ownerId: owner,
  title: "蜘蛛人預購",
  isOpen: true,
  theme: {
    primaryColor: "#ffffff",
    backgroundColor: "#ffffff",
    surfaceColor: "#ffffff",
    headerTextColor: "#000000",
  },
  bannerPosition: { x: 50, y: 50 },
  products: [
    {
      productId: id,
      name: "arbitrary customer name",
      price: 250,
      maxQuantity: 20,
      isEnabled: true,
    },
  ],
};
test("claim settings preserve custom public names for named and legacy products and reject missing multi-item names", async () => {
  fixture();
  globals.namingRows = [{ id, name: input.name, preorder_item_name: "全員款" }];
  assert.equal(
    (await claims.PUT(request("/api/claim-forms", "PUT", claimInput))).status,
    200,
  );
  assert.equal(
    (globals.namingCalls[0].args.p_products as Array<{ name: string }>)[0].name,
    "arbitrary customer name",
  );
  fixture();
  globals.namingRows = [{ id, name: "🇰🇷 蜘蛛人", preorder_item_name: "" }];
  assert.equal(
    (await claims.PUT(request("/api/claim-forms", "PUT", claimInput))).status,
    200,
  );
  fixture();
  globals.namingRows = [
    { id, name: "🇰🇷 蜘蛛人", preorder_item_name: "" },
    { id: other, name: "🇯🇵 蜘蛛人 A款", preorder_item_name: "A款" },
  ];
  assert.equal(
    (
      await claims.PUT(
        request("/api/claim-forms", "PUT", {
          ...claimInput,
          products: [
            ...claimInput.products,
            { ...claimInput.products[0], productId: other },
          ],
        }),
      )
    ).status,
    400,
  );
  assert.equal(globals.namingCalls.length, 0);
  fixture();
  globals.namingRows = [{ id, name: "legacy", preorder_item_name: null }];
  assert.equal(
    (await claims.PUT(request("/api/claim-forms", "PUT", claimInput))).status,
    200,
  );
  assert.equal(
    (globals.namingCalls[0].args.p_products as Array<{ name: string }>)[0].name,
    "arbitrary customer name",
  );
  fixture();
  assert.equal(
    (await claims.PUT(request("/api/claim-forms", "PUT", claimInput))).status,
    400,
  );
  assert.equal(globals.namingCalls.length, 0);
});

test("inventory adapters preserve named single items and variants from the API", () => {
  const { adaptProduct } = findModule("adapters/productAdapter.js");
  assert.equal(adaptProduct({ preorderItemName: "" }).preorderItemName, "");
  assert.equal(
    adaptProduct({ preorderItemName: "全員款" }).preorderItemName,
    "全員款",
  );
  assert.equal(
    adaptProduct({ preorder_item_name: "A款" }).preorderItemName,
    "A款",
  );
  assert.equal(
    adaptProduct({ preorder_item_name: null }).preorderItemName,
    undefined,
  );
});
