import { expect, test } from "@playwright/test";

test("public QR preview renders recommendations and purchase CTA", async ({
  page,
}) => {
  await page.goto("/qr/preview?channel=shopee");

  await expect(
    page.getByRole("heading", { name: "感謝您的購買" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "猜你喜歡" })).toBeVisible();
  await expect(page.getByRole("link", { name: /前往蝦皮賣場/ })).toBeVisible();
});
