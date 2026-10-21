const { cp, mkdir } = require("node:fs/promises");
const path = require("node:path");

async function copyMigrations() {
  const sourceDirectory = path.resolve(__dirname, "../src/infra/database/migrations");
  const targetDirectory = path.resolve(__dirname, "../dist/infra/database/migrations");
  await mkdir(targetDirectory, { recursive: true });
  await cp(sourceDirectory, targetDirectory, { recursive: true });
}

copyMigrations().catch((error) => {
  console.error("Failed to copy database migrations", error);
  process.exitCode = 1;
});
