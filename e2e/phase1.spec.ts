import { expect, test } from "@playwright/test";

test("fixture canvas renders and verified findings follow undo and redo", async ({ page }) => {
  let apiCalls = 0;
  await page.route("**/api/**", async (route) => {
    apiCalls += 1;
    await route.abort();
  });

  await page.goto("/");
  await expect(page.getByText("Fixture mode · zero model calls")).toBeVisible();
  await expect(page.getByTestId("source-photo")).toBeVisible();
  await expect(page.getByTestId("finding-userstory.no-acceptance-criteria")).toContainText("Verified");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.getByTestId("graph-canvas")).toContainText("Sign in with email");

  await page.getByTestId("acceptance-fix").click();
  await expect(page.getByTestId("finding-userstory.no-acceptance-criteria")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("finding-userstory.no-acceptance-criteria")).toContainText("Verified");
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByTestId("finding-userstory.no-acceptance-criteria")).toHaveCount(0);

  expect(apiCalls).toBe(0);
});

test("Phase 2 sample sketch replays through the SSE API with the network off", async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Interpret April release fixture" }).click();
  await expect(page.getByTestId("graph-canvas")).toContainText("April launch", { timeout: 10_000 });
  await expect(page.getByTestId("graph-canvas")).toContainText("Invite teammates");
  await expect(page.getByTestId("graph-canvas")).toContainText("Export the report");
  await expect(page.getByText("Fixture mode · zero model calls")).toBeVisible();
  await page.getByText("Assumptions & questions").click();
  await expect(page.getByText("The two notes are grouped under “April launch”.")).toBeVisible();
});

test("Phase 3 edits a backlog story and requires explicit approval for GitHub dry run", async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Interpret Member experience fixture" }).click();
  await expect(page.getByTestId("graph-canvas")).toContainText("View my profile", { timeout: 10_000 });
  await page.getByRole("tab", { name: /Outputs/ }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();

  const titleFields = page.getByLabel("Title");
  await titleFields.nth(1).fill("View my member profile");
  await page.getByRole("button", { name: "Save user patch" }).nth(1).click();
  await expect(page.getByLabel("Title").nth(1)).toHaveValue("View my member profile");

  await page.getByRole("button", { name: /Prepare 1 issue/ }).click();
  await expect(page.getByText("Pending issue · octo/demo")).toBeVisible();
  await expect(page.getByText("View my member profile", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve dry run" }).click();
  await expect(page.getByText("Dry run recorded; no issue was sent.")).toBeVisible();
});
