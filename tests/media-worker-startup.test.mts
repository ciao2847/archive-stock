import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const runner = resolve("scripts/media-worker/run-local.mjs");
function check(overrides: Record<string, string>) {
  return spawnSync(process.execPath, [runner, "--check"], {
    encoding: "utf8",
    env: {
      ...process.env,
      MEDIA_WORKER_ENV_FILE: resolve(".local/missing-test-worker-config"),
      SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      ...overrides,
    },
    timeout: 15000,
  });
}
test("video worker refuses missing credentials before any queue work", () => {
  const result = check({});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /尚未啟動影片處理/);
  assert.match(result.stderr, /\.env\.media-worker/);
});
test("video worker rejects a publishable key without logging its value", () => {
  const key = "sb_publishable_fake_public_key_for_test";
  const result = check({
    SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_SECRET_KEY: key,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不能使用 Publishable/);
  assert.equal((result.stdout + result.stderr).includes(key), false);
});
test("video worker checks conversion binaries before contacting the database or claiming jobs", () => {
  const key = "sb_secret_fake_key_for_startup_test";
  const result = check({
    SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_SECRET_KEY: key,
    FFMPEG_BIN: resolve(".local/missing-test-ffmpeg"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /無法執行 ffmpeg/);
  assert.match(result.stderr, /尚未取出任何影片任務/);
  assert.equal((result.stdout + result.stderr).includes(key), false);
});
