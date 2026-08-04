// SPDX-License-Identifier: AGPL-3.0-only
import { loadDotEnv, readConfig } from "./config.js";
import { createPool } from "./db.js";
import { deleteUserSessions, writeAuditEvent } from "./repositories/auth.js";
import { resetUserTwoFactor } from "./repositories/twoFactor.js";

function usernameFromArgs(): string | undefined {
  const index = process.argv.indexOf("--username");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

loadDotEnv();
const config = readConfig();
const username = usernameFromArgs();
if (!username) {
  console.error(
    "Usage: node dist/twoFactorResetCli.js --username EXACT_USERNAME",
  );
  process.exit(2);
}

const pool = createPool(config.DATABASE_URL);
try {
  const result = await pool.query<{
    id: string;
    username: string;
    two_factor_required: boolean;
  }>(
    "select id, username, two_factor_required from users where username = $1",
    [username],
  );
  const user = result.rows[0];
  if (!user) {
    console.error(`No user found with exact username: ${username}`);
    process.exit(1);
  }
  await resetUserTwoFactor(pool, user.id);
  await deleteUserSessions(pool, user.id);
  await writeAuditEvent(pool, {
    actorUserId: null,
    eventType: "two_factor_operator_reset",
    entityType: "user",
    entityId: user.id,
    metadata: {
      username: user.username,
      preservedRequirement: user.two_factor_required,
    },
  });
  console.log(`2FA reset for ${user.username}; sessions revoked.`);
  if (user.two_factor_required && !config.TWO_FACTOR_ENABLED) {
    console.log(
      "This account still requires 2FA, but deployment enrollment is disabled. Enable TWO_FACTOR_ENABLED before the user signs in to re-enroll.",
    );
  }
} finally {
  await pool.end();
}
