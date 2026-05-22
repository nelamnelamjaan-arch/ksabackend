import "./loadRootEnv.js";
import { createApp } from "./createApp.js";
import { connectDb } from "./config/database.js";
import { ensureCatalogDefaults, seedDemoUsers } from "./config/seed.js";
import { ensureKiranAdmin } from "./config/ensureKiranAdmin.js";

let initPromise = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      const connected = await connectDb();
      if (connected) {
        await ensureCatalogDefaults();
        await ensureKiranAdmin();
        if (process.env.SEED_DEMO === "true") {
          await seedDemoUsers();
        }
      }
      return connected;
    })();
  }
  return initPromise;
}

const dbInitMiddleware = (req, res, next) => {
  ensureInitialized().then(() => next()).catch(next);
};

const app = createApp({ beforeRoutes: [dbInitMiddleware] });

export default app;
