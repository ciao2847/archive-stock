import assert from "node:assert/strict";
import { test } from "node:test";
import { getTaipeiDay, sumStallSales } from "../src/lib/stall-sales.ts";

test("stall revenue uses Taiwan midnight, including month and year boundaries", () => {
  assert.deepEqual(getTaipeiDay(new Date("2026-10-13T16:00:00Z")), {
    date: "2026-10-14",
    start: "2026-10-13T16:00:00.000Z",
    end: "2026-10-14T16:00:00.000Z",
  });
  assert.equal(
    getTaipeiDay(new Date("2026-10-13T15:59:59Z")).date,
    "2026-10-13",
  );
  assert.equal(
    getTaipeiDay(new Date("2026-12-31T16:00:00Z")).date,
    "2027-01-01",
  );
});
test("revenue sums recorded sale prices and quantities in cents", () => {
  assert.deepEqual(
    sumStallSales([
      { order_items: [{ quantity: 2, unit_price: 350 }] },
      {
        order_items: [
          { quantity: 3, unit_price: 199.99 },
          { quantity: 1, unit_price: 0.1 },
        ],
      },
    ]),
    { revenue: 1300.07, orderCount: 2, itemCount: 6 },
  );
  assert.deepEqual(sumStallSales([]), {
    revenue: 0,
    orderCount: 0,
    itemCount: 0,
  });
});
