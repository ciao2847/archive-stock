import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFinanceOverview,
  getBimonthlyPeriod,
  getCurrentPeriod,
  isBimonthlyPeriod,
  periodCostSchema,
  orderGrossRevenue,
} from "../src/lib/accounting.ts";

const otherOwner = "00000000-0000-4000-8000-000000000002";
const ownerId = "00000000-0000-4000-8000-000000000001";
const input = {
  ownerId,
  start: "2026-07-01",
  end: "2026-08-31",
  amount: 100290,
  notes: "購入總額",
  expectedRevision: 0,
  confirmed: true,
};

test("bimonthly dates include leap February and Taiwan midnight boundaries", () => {
  assert.deepEqual(getBimonthlyPeriod(2028, 2), {
    start: "2028-01-01",
    end: "2028-02-29",
    label: "2028 年 1–2 月",
  });
  assert.equal(getBimonthlyPeriod(2026, 12).end, "2026-12-31");
  assert.equal(
    getCurrentPeriod(new Date("2026-08-31T15:59:59Z")).start,
    "2026-07-01",
  );
  assert.equal(
    getCurrentPeriod(new Date("2026-08-31T16:00:00Z")).start,
    "2026-09-01",
  );
  for (const dates of [
    ["2026-07-02", "2026-08-31"],
    ["2026-08-01", "2026-09-30"],
    ["2026-07-01", "2026-07-31"],
    ["2026-13-01", "2027-02-28"],
  ]) {
    assert.equal(isBimonthlyPeriod(...(dates as [string, string])), false);
  }
});

test("manual cost entry needs explicit confirmation, valid cents and rejects image fields", () => {
  assert.equal(periodCostSchema.safeParse(input).success, true);
  assert.equal(
    periodCostSchema.safeParse({ ...input, amount: 0 }).success,
    true,
  );
  for (const change of [
    { confirmed: false },
    { amount: -1 },
    { amount: NaN },
    { amount: Infinity },
    { amount: 10.001 },
    { amount: 1e12 },
    { expectedRevision: -1 },
    { end: "2026-07-31" },
    { calculatorPath: "obsolete-image" },
    { evidencePaths: [] },
  ])
    assert.equal(
      periodCostSchema.safeParse({ ...input, ...change }).success,
      false,
      JSON.stringify(change),
    );
});

test("poster revenue excludes buyer shipping, applies discounts and deducts confirmed costs once", () => {
  assert.equal(
    orderGrossRevenue({
      discount: 100,
      shipping_income: 60,
      order_items: [{ quantity: 2, unit_price: 1000 }],
    }),
    1900,
  );
  const order = {
    owner_id: ownerId,
    status: "packed",
    packed_at: "2026-08-31T15:59:59Z",
    created_at: "2026-07-01T00:00:00Z",
    discount: 0,
    shipping_income: 0,
    order_items: [{ quantity: 1, unit_price: 137925 }],
    settlement_orders: [],
  };
  const cost = {
    owner_id: ownerId,
    period_start: input.start,
    period_end: input.end,
    amount: 100290,
  };
  const unrelated = { ...order, owner_id: otherOwner };
  const nextPeriod = { ...order, packed_at: "2026-08-31T16:00:00Z" };
  const legacySettled = {
    ...order,
    settlement_orders: [{ order_id: "already-settled" }],
  };
  const overview = buildFinanceOverview(
    [ownerId, otherOwner],
    [cost],
    [],
    [
      order,
      unrelated,
      nextPeriod,
      legacySettled,
      { ...order, status: "pending" },
    ],
  );
  assert.deepEqual(overview[ownerId], {
    revenue: 137925,
    cost: 100290,
    profit: 37635,
  });
  assert.deepEqual(overview[otherOwner], { revenue: 0, cost: 0, profit: 0 });
  assert.equal(
    buildFinanceOverview([ownerId], [{ ...cost, amount: 110000 }], [], [order])[
      ownerId
    ].cost,
    110000,
  );
  // A snapshot is authoritative even if a live order later changes.
  assert.deepEqual(
    buildFinanceOverview(
      [ownerId],
      [cost],
      [
        {
          owner_id: ownerId,
          period_start: input.start,
          revenue: 137925,
          cost: 100290,
          profit: 37635,
        },
      ],
      [{ ...order, order_items: [{ quantity: 1, unit_price: 999999 }] }],
    )[ownerId],
    overview[ownerId],
  );
});
