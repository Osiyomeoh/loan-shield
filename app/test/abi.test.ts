import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loanShieldAbi } from "../src/abi.js";

const artifact = fileURLToPath(new URL("../../out/LoanShield.sol/LoanShield.json", import.meta.url));
// CI builds the contracts first and sets REQUIRE_ARTIFACTS=1, so a missing build fails there instead of skipping.
const skip = !existsSync(artifact) && !process.env.REQUIRE_ARTIFACTS ? "run `arc-forge build` in the repo root first" : false;

test("src/abi.ts matches the compiled LoanShield ABI", { skip }, () => {
  const compiled = JSON.parse(readFileSync(artifact, "utf8")).abi.filter((x: { type: string }) => x.type !== "constructor");
  assert.deepEqual(loanShieldAbi, compiled);
});
